# Self-service password reset — design

**Date:** 2026-07-29
**Status:** approved

## Problem

Flux has no way for a user to recover a forgotten password. `/login` offers no
"Forgot password?" link, there is no reset route, and the only path to setting a
password is the invite flow (`/register?token=…`, with `/set-password`
redirecting into it). A user who forgets their password is locked out until an
admin intervenes manually.

## Decisions

| Decision | Choice |
|---|---|
| Recovery mechanism | Self-service: email a one-time link from a public `/forgot-password` form |
| Who may reset | `ACTIVE` users with a local password only. `SUSPENDED` and `INVITED` get the same generic response but no email |
| Other sessions after reset | Killed — a reset must actually lock out an attacker |
| Token lifetime | 60 minutes, single-use |

Admin-triggered reset was considered and rejected for v1: it puts an admin in
the loop for every lockout. SMTP is already configured, so the self-service path
is viable.

## Data model

New model, plus one column on `User`:

```prisma
model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique   // SHA-256 hex; the raw token exists only in the email
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

```prisma
// User
passwordChangedAt   DateTime?
passwordResetTokens PasswordResetToken[]
```

`onDelete: Cascade` is deliberate: deleting a user must not leave live reset
tokens pointing at a missing row.

The token follows the existing invite contract in `lib/tokens.ts` — 32 bytes of
entropy generated once, mailed raw, only the SHA-256 hash persisted, looked up
by the unique hash index. A DB leak yields no usable tokens.

Delivered via `prisma migrate dev`. **The generated migration will also try to
drop the hand-authored TimeEntry partial index — that statement must be removed
before committing** (see the project's migration notes).

## Flow

1. `/login` gains a "Forgot password?" link → `/forgot-password`.
2. **`requestPasswordReset(email)`** — Zod-validated via `requestPasswordResetSchema`.
   Rate-limited per email (3 / hour) and via an instance-wide fallback, matching
   the two-tier pattern in `registerWithInvite`.
   Issues a token only when the user exists, is `ACTIVE`, and has a
   `hashedPassword`. Marks that user's outstanding unused tokens as used, then
   creates the new one and mails the link.
   **Always returns the same "if that email is registered, we've sent a link"
   result**, whatever happened — no account enumeration. This matches
   `authorize()`, which already refuses to distinguish "wrong password" from
   "no such user".
3. Link → `/reset-password?token=…`. The server component validates the token
   before rendering the form, so a dead link says so immediately rather than
   after the user types a new password. Failure reasons are not distinguished
   (expired / used / unknown all look identical), mirroring
   `validateInviteToken`.
4. **`resetPassword({ token, password })`** — validated with the existing
   `setPasswordSchema` (`{ token, password }`), which already enforces the
   project password policy. Hashes the presented token, looks it up by
   `tokenHash`, rejects used / expired / non-`ACTIVE`. Then one transaction:
   - `bcrypt.hash(password, 12)` (same cost factor as registration)
   - set `hashedPassword` and `passwordChangedAt = now`
   - mark the token used, guarded on `usedAt: null` via `updateMany` so two
     concurrent redemptions cannot both win (same technique as the invite claim)
   - mark the user's other outstanding tokens used
   - write an `AuditLog` entry (`user.password_reset`)

   On success, redirect to `/login` with a success notice.

## Session invalidation

The check belongs in `requireUser` (`lib/permissions.ts`), not in the Auth.js
`jwt` callback.

`requireUser` already re-fetches the user from the DB on every request and
already rejects any non-`ACTIVE` account, and it is memoised per request with
React `cache()`. The row it loads carries `passwordChangedAt` for free, so
comparing it against the session costs **no additional query**. Doing the same
check in the `jwt` callback would instead add a genuinely new, un-memoised
lookup on every authenticated request.

Mechanics:

- `authorize()` returns `passwordChangedAt` alongside the identity fields.
- The `jwt` callback stamps it into the token as `pwdAt` (epoch ms, `0` when
  the user has never reset).
- The `session` callback exposes `session.user.pwdAt`.
- `requireUser` throws `AuthorizationError("UNAUTHENTICATED")` when
  `user.passwordChangedAt` is newer than the session's `pwdAt` — the existing
  401 → redirect-to-login path, so no new error code or call-site handling.

Both `next-auth` and `next-auth/jwt` module augmentations in
`src/types/next-auth.d.ts` gain the field.

`proxy.ts` reads the raw token with `getToken` and does not run these callbacks,
so a stale token still passes middleware — it is then rejected by `requireUser`
on the page or action behind it. That matches the existing security model, in
which middleware is routing convenience and `lib/permissions.ts` is the actual
boundary.

## Email

`sendPasswordResetEmail` in `lib/mail.ts`, following the established contract
there exactly: never throws, returns `SendResult`, logs the link and returns
`{ sent: false, reason: "smtp-unconfigured" }` when SMTP is absent so local dev
still works. Same inline-hex dark template as the invite mail (email has no
access to the app's CSS tokens — the one sanctioned place for raw hex).

The link is built from `NEXT_PUBLIC_APP_URL`, never hardcoded.

## Files

- `prisma/schema.prisma` + migration
- `src/features/auth/schemas.ts` — add `requestPasswordResetSchema`; reuse
  `setPasswordSchema` for the reset submit
- `src/features/auth/actions.ts` — `requestPasswordReset`, `resetPassword`,
  `validateResetToken`
- `src/lib/mail.ts` — `sendPasswordResetEmail`
- `src/lib/auth.ts` — carry `pwdAt` through `authorize` / `jwt` / `session`
- `src/lib/permissions.ts` — the staleness check in `requireUser`
- `src/types/next-auth.d.ts` — `pwdAt` on `User`, `Session["user"]`, and `JWT`
- `src/app/(auth)/forgot-password/page.tsx` + `ForgotPasswordForm.tsx`
- `src/app/(auth)/reset-password/page.tsx` + `ResetPasswordForm.tsx`
- `src/features/auth/components/LoginForm.tsx` — the link

## Testing

Vitest over the two actions and the callback:

- expired token rejected
- already-used token rejected
- token for a `SUSPENDED` user rejected
- enumeration safety: identical result for a registered and an unregistered email
- rate limit trips after the configured number of requests
- issuing a new token invalidates the previous one
- `requireUser` rejects a session whose `pwdAt` predates `passwordChangedAt`
- `requireUser` accepts a session issued after the reset
- `requireUser` still accepts a user who has never reset (`passwordChangedAt`
  null)

## Out of scope

- Admin-triggered reset from `/admin/users` (deferred; revisit if lockouts
  where the user has no inbox access turn out to be common)
- Email change / verification
- 2FA, or any second factor on the reset itself
