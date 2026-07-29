# Self-Service Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user who forgot their password recover it themselves via a one-time emailed link, and make that reset end every other signed-in session.

**Architecture:** A new `PasswordResetToken` table stores only the SHA-256 hash of a high-entropy token (the raw value exists only in the email), exactly mirroring the existing `Invite` contract in `lib/tokens.ts`. Two Server Actions bracket the flow: one issues + mails a token and always returns the same generic result (no account enumeration), one redeems it inside a transaction that rewrites the password hash, stamps `User.passwordChangedAt`, burns the token, and writes an audit entry. Session revocation piggybacks on `requireUser`, which already re-fetches the user per request under React `cache()` — so it costs no extra query.

**Tech Stack:** Next.js 16 App Router + Server Actions, Prisma (PostgreSQL), Auth.js v5 (JWT sessions), Zod 4, react-hook-form, bcryptjs, nodemailer, Vitest.

## Global Constraints

- TypeScript strict — no `any`.
- Every Server Action validates input with a Zod schema from `src/features/auth/schemas.ts` before touching the DB. Never re-validate ad hoc.
- Schema changes go through `prisma migrate dev`. **The generated migration will also contain a `DROP INDEX` for the hand-authored TimeEntry one-running-timer partial index — delete that statement before committing.**
- Never reveal whether an email belongs to a registered account. Every outcome of `requestPasswordReset` returns the identical result.
- Reset tokens: 32 bytes of entropy, SHA-256 hashed at rest, single-use, 60-minute lifetime.
- bcrypt cost factor 12, matching `registerWithInvite`.
- Absolute URLs come from `process.env.NEXT_PUBLIC_APP_URL`. Never hardcode `flux.foodverse.io`.
- Mail helpers never throw: they return `SendResult` and log the link when SMTP is unconfigured.
- No new dependencies.
- Raw hex colours are allowed **only** inside the email HTML templates in `lib/mail.ts`. Everywhere else use theme tokens.
- Run `npx vitest run <path>` for a single test file; `npm run lint` before the final commit.

---

### Task 1: Data model — `PasswordResetToken` + `User.passwordChangedAt`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_password_reset/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `PasswordResetToken` with fields `id: string`, `userId: string`, `tokenHash: string`, `expiresAt: Date`, `usedAt: Date | null`, `createdAt: Date`. New nullable column `User.passwordChangedAt: Date | null` and relation `User.passwordResetTokens`.

- [ ] **Step 1: Add the model to the schema**

In `prisma/schema.prisma`, after the `Invite` model, add:

```prisma
/// Single-use, expiring password-reset token. Only the SHA-256 hash of the
/// token is stored — the raw value exists solely in the email we send, so a
/// database leak yields nothing usable. Same contract as Invite.tokenHash.
model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

- [ ] **Step 2: Add the User column and relation**

In the `User` model, add `passwordChangedAt` next to the other scalar fields:

```prisma
  passwordChangedAt DateTime?
```

and add to the relations block:

```prisma
  passwordResetTokens PasswordResetToken[]
```

- [ ] **Step 3: Generate the migration**

Run: `npx prisma migrate dev --name password_reset`
Expected: a new folder under `prisma/migrations/` containing `CREATE TABLE "PasswordResetToken"`, its unique index on `tokenHash`, its index on `userId`, and `ALTER TABLE "User" ADD COLUMN "passwordChangedAt"`.

- [ ] **Step 4: Strip the unrelated index drop from the migration**

Open the generated `migration.sql`. If it contains a `DROP INDEX` for the TimeEntry one-running-timer partial index (it is hand-authored SQL that Prisma does not know about), **delete that statement**. Leave everything else untouched.

Verify: `npx prisma migrate status` reports the database in sync.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(auth): add PasswordResetToken model and User.passwordChangedAt"
```

---

### Task 2: Zod schema for the request form

**Files:**
- Modify: `src/features/auth/schemas.ts`
- Test: `src/features/auth/schemas.test.ts`

**Interfaces:**
- Consumes: existing `emailSchema` from the same file.
- Produces: `requestPasswordResetSchema` — `z.object({ email: emailSchema })`, and the type `RequestPasswordResetInput = { email: string }`. The reset-submit step reuses the **existing** `setPasswordSchema` (`{ token: string; password: string }`) — do not add a second schema of that shape.

- [ ] **Step 1: Write the failing test**

Append to `src/features/auth/schemas.test.ts`:

```ts
describe("requestPasswordResetSchema", () => {
  it("normalises the email the same way login does", () => {
    const result = requestPasswordResetSchema.safeParse({
      email: "  User@Company.COM ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("user@company.com");
  });

  it("rejects a malformed email", () => {
    expect(requestPasswordResetSchema.safeParse({ email: "nope" }).success).toBe(
      false,
    );
  });

  it("rejects a missing email", () => {
    expect(requestPasswordResetSchema.safeParse({}).success).toBe(false);
  });
});
```

Add `requestPasswordResetSchema` to the existing import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/auth/schemas.test.ts`
Expected: FAIL — `requestPasswordResetSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `src/features/auth/schemas.ts`, after `loginSchema`:

```ts
/**
 * Forgot-password request. Email only — the response is identical whether or
 * not the address belongs to an account, so nothing else is needed or wanted.
 */
export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});
```

and with the other exported types:

```ts
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/auth/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/schemas.ts src/features/auth/schemas.test.ts
git commit -m "feat(auth): add requestPasswordResetSchema"
```

---

### Task 3: Password-reset email

**Files:**
- Modify: `src/lib/mail.ts`

**Interfaces:**
- Consumes: the module-private `getTransport()`, `escapeHtml()`, and the exported `SendResult` type, all already in this file.
- Produces: `sendPasswordResetEmail(params: SendPasswordResetEmailParams): Promise<SendResult>` where `SendPasswordResetEmailParams = { to: string; resetUrl: string; expiresInMinutes: number }`.

This task has no unit test: the module's other senders have none either (they are thin nodemailer wrappers whose only branch — SMTP configured or not — is exercised by the action tests in Task 4). Follow the file's established structure exactly: an interface, a `build…Html`, a `build…Text`, then the sender.

- [ ] **Step 1: Add the params interface and HTML builder**

Add near the other senders in `src/lib/mail.ts`:

```ts
export interface SendPasswordResetEmailParams {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

function buildPasswordResetHtml({
  resetUrl,
  expiresInMinutes,
}: SendPasswordResetEmailParams): string {
  const url = escapeHtml(resetUrl);
  const mins = String(expiresInMinutes);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:'Outfit',Arial,Helvetica,sans-serif;color:#f5f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141414;border:1px solid #2a2a2a;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <div style="font-size:22px;font-weight:700;color:#f5f5f7;">Flux<span style="color:#ff6b35;">.</span></div>
                <h1 style="font-size:20px;font-weight:600;margin:20px 0 8px 0;color:#f5f5f7;">Reset your password</h1>
                <p style="font-size:15px;line-height:1.6;color:#9a9a9a;margin:0 0 24px 0;">
                  Use the button below to choose a new password. This link works once and expires in ${mins} minutes.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <a href="${url}" style="display:inline-block;background:#ff6b35;color:#0a0a0a;font-weight:600;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:10px;">
                  Reset password
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px 32px;">
                <p style="font-size:12px;line-height:1.6;color:#9a9a9a;margin:0;">
                  Or paste this link into your browser:<br />
                  <span style="color:#5b8def;word-break:break-all;">${url}</span>
                </p>
                <p style="font-size:12px;color:#6a6a6a;margin:16px 0 0 0;">
                  If you didn't ask to reset your password, you can safely ignore this email — your current password still works.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
```

- [ ] **Step 2: Add the text builder and the sender**

```ts
function buildPasswordResetText({
  resetUrl,
  expiresInMinutes,
}: SendPasswordResetEmailParams): string {
  return [
    "Someone asked to reset the password for your Flux account.",
    "",
    `Choose a new password (this link works once and expires in ${expiresInMinutes} minutes):`,
    resetUrl,
    "",
    "If you didn't ask for this, you can safely ignore this email — your current password still works.",
  ].join("\n");
}

/**
 * Send a password-reset link. Same never-throw contract as the rest of this
 * module: unconfigured SMTP logs the link so local dev can still complete the
 * flow, and a transport failure is returned rather than raised.
 */
export async function sendPasswordResetEmail(
  params: SendPasswordResetEmailParams,
): Promise<SendResult> {
  const transport = getTransport();

  if (!transport) {
    console.info(
      `[mail] SMTP not configured — password reset link for ${params.to}: ${params.resetUrl}`,
    );
    return { sent: false, reason: "smtp-unconfigured" };
  }

  const from = process.env.SMTP_FROM ?? "Flux <no-reply@foodverse.io>";

  try {
    await transport.sendMail({
      from,
      to: params.to,
      subject: "Reset your Flux password",
      text: buildPasswordResetText(params),
      html: buildPasswordResetHtml(params),
    });
    return { sent: true };
  } catch (err) {
    console.error("[mail] password-reset send failed", err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : "unknown-error",
    };
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mail.ts
git commit -m "feat(auth): add password-reset email template and sender"
```

---

### Task 4: Server Actions — request, validate, redeem

**Files:**
- Modify: `src/features/auth/actions.ts`
- Create: `src/features/auth/password-reset.test.ts`

**Interfaces:**
- Consumes: `requestPasswordResetSchema` and `setPasswordSchema` (Task 2), `sendPasswordResetEmail` (Task 3), the `PasswordResetToken` model (Task 1), plus the file's existing `ActionResult` type, `hashToken`, `rateLimit`, and `prisma`.
- Produces:
  - `requestPasswordReset(input: unknown): Promise<ActionResult>` — **always** `{ ok: true }` except on schema failure or rate-limit trip.
  - `validateResetToken(token: string): Promise<{ valid: boolean }>`
  - `resetPassword(input: unknown): Promise<ActionResult>`
  - Module constant `RESET_TOKEN_TTL_MINUTES = 60`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/auth/password-reset.test.ts`:

```ts
// Password-reset action tests. Mocking mirrors admin/actions.test.ts: @/lib/db
// is a hand-rolled mock whose `prisma.x` and the `tx` given to `$transaction`
// are the SAME object, so assertions read off one place.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/mail", () => ({
  sendPasswordResetEmail: vi.fn(async () => ({ sent: true })),
}));

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    user: model(),
    passwordResetToken: model(),
    auditLog: model(),
  };
  prisma.$transaction = vi.fn();
  return { prisma };
});

import { prisma } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/mail";
import { hashToken } from "@/lib/tokens";
import {
  requestPasswordReset,
  resetPassword,
  validateResetToken,
} from "./actions";

const db = prisma as unknown as {
  user: Record<string, Mock>;
  passwordResetToken: Record<string, Mock>;
  auditLog: Record<string, Mock>;
  $transaction: Mock;
};

const ACTIVE_USER = {
  id: "user_1",
  email: "user@company.com",
  status: "ACTIVE",
  hashedPassword: "$2a$12$existinghash",
};

// The rate limiter keys on the email and its bucket map is module-level state
// that vi.clearAllMocks() does NOT reset. Every case that calls
// requestPasswordReset therefore uses its own address, or the 3/hour limit
// leaks across tests and fails whichever one happens to run fourth.

function futureDate(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Run the transaction callback against the same mock object as `prisma`.
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
});

describe("requestPasswordReset", () => {
  it("issues and mails a token for an ACTIVE user", async () => {
    db.user.findUnique.mockResolvedValue(ACTIVE_USER);
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    db.passwordResetToken.create.mockResolvedValue({ id: "tok_1" });

    const result = await requestPasswordReset({ email: "issue@company.com" });

    expect(result.ok).toBe(true);
    expect(db.passwordResetToken.create).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);

    // The raw token must never be persisted — only its hash.
    const created = db.passwordResetToken.create.mock.calls[0][0].data;
    const mailed = (sendPasswordResetEmail as Mock).mock.calls[0][0].resetUrl;
    const rawToken = new URL(mailed).searchParams.get("token")!;
    expect(rawToken).toBeTruthy();
    expect(created.tokenHash).toBe(hashToken(rawToken));
    expect(created.tokenHash).not.toBe(rawToken);
  });

  it("invalidates outstanding tokens before issuing a new one", async () => {
    db.user.findUnique.mockResolvedValue(ACTIVE_USER);
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    db.passwordResetToken.create.mockResolvedValue({ id: "tok_2" });

    await requestPasswordReset({ email: "outstanding@company.com" });

    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user_1", usedAt: null }),
      }),
    );
  });

  it("returns the same result for an unregistered email and sends nothing", async () => {
    db.user.findUnique.mockResolvedValue(null);

    const known = { ok: true };
    const result = await requestPasswordReset({ email: "nobody@company.com" });

    expect(result).toEqual(known);
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns the same result for a SUSPENDED user and sends nothing", async () => {
    db.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, status: "SUSPENDED" });

    const result = await requestPasswordReset({ email: "suspended@company.com" });

    expect(result.ok).toBe(true);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns the same result for an SSO-only user with no password", async () => {
    db.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, hashedPassword: null });

    const result = await requestPasswordReset({ email: "sso@company.com" });

    expect(result.ok).toBe(true);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("rate-limits repeated requests for the same email", async () => {
    db.user.findUnique.mockResolvedValue(ACTIVE_USER);
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    db.passwordResetToken.create.mockResolvedValue({ id: "tok_3" });

    const email = "ratelimit@company.com";
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await requestPasswordReset({ email }));
    }

    expect(results.some((r) => !r.ok)).toBe(true);
  });
});

describe("validateResetToken", () => {
  it("accepts an unused, unexpired token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: futureDate(30),
      user: { status: "ACTIVE" },
    });

    expect(await validateResetToken("raw")).toEqual({ valid: true });
  });

  it("rejects an expired token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      user: { status: "ACTIVE" },
    });

    expect(await validateResetToken("raw")).toEqual({ valid: false });
  });

  it("rejects an already-used token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      usedAt: new Date(),
      expiresAt: futureDate(30),
      user: { status: "ACTIVE" },
    });

    expect(await validateResetToken("raw")).toEqual({ valid: false });
  });

  it("rejects an unknown token without hitting the DB twice", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(null);

    expect(await validateResetToken("raw")).toEqual({ valid: false });
    expect(db.passwordResetToken.findUnique).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty token without touching the DB", async () => {
    expect(await validateResetToken("")).toEqual({ valid: false });
    expect(db.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  // Distinct token per case, for the same reason as the emails above: the
  // per-token limiter (5 / 15 min) is module-level state that survives
  // clearAllMocks, and a shared token would put these cases exactly on its
  // boundary.
  const input = (id: string) => ({
    token: `raw-token-${id}`,
    password: "newpassword1",
  });

  it("rewrites the password, stamps passwordChangedAt, and burns the token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: futureDate(30),
      user: ACTIVE_USER,
    });
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    db.user.update.mockResolvedValue(ACTIVE_USER);
    db.auditLog.create.mockResolvedValue({});

    const result = await resetPassword(input("happy"));

    expect(result.ok).toBe(true);

    const userUpdate = db.user.update.mock.calls[0][0];
    expect(userUpdate.where).toEqual({ id: "user_1" });
    expect(userUpdate.data.hashedPassword).toMatch(/^\$2[aby]\$12\$/);
    expect(userUpdate.data.passwordChangedAt).toBeInstanceOf(Date);

    // The token is burned with a guard on usedAt so a concurrent redemption
    // cannot also win.
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "tok_1", usedAt: null }),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rejects an expired token without writing anything", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      user: ACTIVE_USER,
    });

    const result = await resetPassword(input("expired"));

    expect(result.ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects an already-used token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: new Date(),
      expiresAt: futureDate(30),
      user: ACTIVE_USER,
    });

    const result = await resetPassword(input("used"));

    expect(result.ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects a token whose user is no longer ACTIVE", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: futureDate(30),
      user: { ...ACTIVE_USER, status: "SUSPENDED" },
    });

    const result = await resetPassword(input("suspended"));

    expect(result.ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects a password that fails the policy", async () => {
    const result = await resetPassword({ token: "raw-token-weak", password: "short" });

    expect(result.ok).toBe(false);
    expect(db.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("loses the race when a concurrent redemption burns the token first", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: futureDate(30),
      user: ACTIVE_USER,
    });
    // The guarded updateMany matches nothing — someone else already used it.
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

    const result = await resetPassword(input("race"));

    expect(result.ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/auth/password-reset.test.ts`
Expected: FAIL — `requestPasswordReset`, `validateResetToken`, and `resetPassword` are not exported from `./actions`.

- [ ] **Step 3: Add the imports and constants**

In `src/features/auth/actions.ts`, extend the existing imports:

```ts
import { generateInviteToken, hashToken } from "@/lib/tokens";
import { sendPasswordResetEmail } from "@/lib/mail";
import {
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  setPasswordSchema,
} from "./schemas";
```

and add below the existing `FIFTEEN_MIN` constant:

```ts
const ONE_HOUR = 60 * 60_000;

/** Reset links are deliberately short-lived — see the password-reset design doc. */
const RESET_TOKEN_TTL_MINUTES = 60;

/** Same generic outcome for every request, so the response can't be used to probe for accounts. */
const RESET_REQUEST_ACCEPTED: ActionResult = { ok: true };

/** One message for every unusable token — expired, used, and unknown must look identical. */
const RESET_TOKEN_INVALID = "This reset link is invalid or has expired.";
```

- [ ] **Step 4: Implement `requestPasswordReset`**

Append to `src/features/auth/actions.ts`:

```ts
/**
 * Issue a password-reset link. Rate-limited per email and via an instance-wide
 * fallback, mirroring `registerWithInvite`.
 *
 * ALWAYS returns the same accepted result once validation and rate limiting
 * pass — whether the address is unknown, suspended, or SSO-only. The caller
 * therefore learns nothing about who has an account. Only a schema failure or a
 * rate-limit trip produces a different answer, and neither depends on the
 * address existing.
 */
export async function requestPasswordReset(input: unknown): Promise<ActionResult> {
  const parsed = requestPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const { email } = parsed.data;

  const perEmail = rateLimit(`reset:email:${email}`, {
    limit: 3,
    windowMs: ONE_HOUR,
  });
  const global = rateLimit("reset:global", {
    limit: 100,
    windowMs: ONE_HOUR,
  });
  if (!perEmail.ok || !global.ok) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Silently no-op for anyone who can't use a password: unknown address,
  // non-ACTIVE account, or an SSO-only account with no local password.
  if (!user || user.status !== "ACTIVE" || !user.hashedPassword) {
    return RESET_REQUEST_ACCEPTED;
  }

  const token = generateInviteToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

  // Requesting a new link retires any earlier one, so at most a single live
  // token exists per user.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await sendPasswordResetEmail({
    to: user.email,
    resetUrl: `${appUrl}/reset-password?token=${encodeURIComponent(token)}`,
    expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
  });

  return RESET_REQUEST_ACCEPTED;
}
```

- [ ] **Step 5: Implement `validateResetToken`**

```ts
/**
 * Check a reset token before rendering the form, so a dead link says so up
 * front rather than after the user types a new password. Mirrors
 * `validateInviteToken`: every failure reason looks identical from outside.
 */
export async function validateResetToken(
  token: string,
): Promise<{ valid: boolean }> {
  if (!token) return { valid: false };

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      usedAt: true,
      expiresAt: true,
      user: { select: { status: true } },
    },
  });

  if (
    !record ||
    record.usedAt ||
    record.expiresAt < new Date() ||
    record.user.status !== "ACTIVE"
  ) {
    return { valid: false };
  }
  return { valid: true };
}
```

- [ ] **Step 6: Implement `resetPassword`**

```ts
/**
 * Redeem a reset token and set a new password. In one transaction: burn the
 * token (guarded on `usedAt: null` via updateMany, so two concurrent
 * redemptions can't both win — same technique as the invite claim), write the
 * new hash, stamp `passwordChangedAt` so every session issued earlier stops
 * being honoured (see `requireUser`), and record an audit entry.
 */
export async function resetPassword(input: unknown): Promise<ActionResult> {
  const parsed = setPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { token, password } = parsed.data;
  const tokenHash = hashToken(token);

  const perToken = rateLimit(`reset:token:${tokenHash}`, {
    limit: 5,
    windowMs: FIFTEEN_MIN,
  });
  if (!perToken.ok) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      usedAt: true,
      expiresAt: true,
      user: { select: { status: true, email: true } },
    },
  });

  const now = new Date();
  if (
    !record ||
    record.usedAt ||
    record.expiresAt < now ||
    record.user.status !== "ACTIVE"
  ) {
    return { ok: false, error: RESET_TOKEN_INVALID };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  try {
    await prisma.$transaction(async (tx) => {
      const burned = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (burned.count === 0) throw new ResetTokenUnavailableError();

      await tx.user.update({
        where: { id: record.userId },
        data: { hashedPassword, passwordChangedAt: now },
      });

      await tx.auditLog.create({
        data: {
          actorId: record.userId,
          action: "user.password_reset",
          targetType: "User",
          targetId: record.userId,
          metadata: { email: record.user.email, tokenId: record.id },
        },
      });
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof ResetTokenUnavailableError) {
      return { ok: false, error: RESET_TOKEN_INVALID };
    }
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
```

Add the sentinel class next to the existing `InviteUnavailableError`:

```ts
/** Token was claimed or expired between the pre-check and the transaction. */
class ResetTokenUnavailableError extends Error {}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/features/auth/password-reset.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 8: Commit**

```bash
git add src/features/auth/actions.ts src/features/auth/password-reset.test.ts
git commit -m "feat(auth): add password reset request, validate, and redeem actions"
```

---

### Task 5: Session revocation via `requireUser`

**Files:**
- Modify: `src/types/next-auth.d.ts`
- Modify: `src/lib/auth.ts:27-72`
- Modify: `src/lib/permissions.ts:61-72`
- Test: `src/lib/permissions.test.ts`

**Interfaces:**
- Consumes: `User.passwordChangedAt` (Task 1).
- Produces: `pwdAt: number` on the Auth.js `User`, `Session["user"]`, and `JWT` types. `requireUser` throws `AuthorizationError("UNAUTHENTICATED")` for a session issued before the user's last password change. No new error code and no call-site changes.

- [ ] **Step 1: Write the failing test**

Open `src/lib/permissions.test.ts` and follow its existing mocking setup for `@/lib/auth` and `@/lib/db`. Add:

```ts
describe("requireUser — password-change revocation", () => {
  it("rejects a session issued before the last password change", async () => {
    const changedAt = new Date("2026-07-29T12:00:00Z");
    mockAuth.mockResolvedValue({
      user: { id: "user_1", pwdAt: changedAt.getTime() - 60_000 },
    });
    mockDb.user.findUnique.mockResolvedValue({
      id: "user_1",
      status: "ACTIVE",
      passwordChangedAt: changedAt,
    });

    await expect(requireUser()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("accepts a session issued after the last password change", async () => {
    const changedAt = new Date("2026-07-29T12:00:00Z");
    mockAuth.mockResolvedValue({
      user: { id: "user_1", pwdAt: changedAt.getTime() + 60_000 },
    });
    mockDb.user.findUnique.mockResolvedValue({
      id: "user_1",
      status: "ACTIVE",
      passwordChangedAt: changedAt,
    });

    await expect(requireUser()).resolves.toMatchObject({ id: "user_1" });
  });

  it("accepts a user who has never reset their password", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user_1", pwdAt: 0 } });
    mockDb.user.findUnique.mockResolvedValue({
      id: "user_1",
      status: "ACTIVE",
      passwordChangedAt: null,
    });

    await expect(requireUser()).resolves.toMatchObject({ id: "user_1" });
  });
});
```

Note: `requireUser` is wrapped in React `cache()`, which memoises per request. If the existing tests in this file already clear that between cases, follow the same approach; otherwise give each case a distinct user id so no memoised value is reused.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/permissions.test.ts`
Expected: FAIL — the revocation case resolves instead of rejecting, because no comparison exists yet.

- [ ] **Step 3: Extend the type augmentation**

In `src/types/next-auth.d.ts`, add `pwdAt` to all three interfaces:

```ts
declare module "next-auth" {
  interface User {
    username: string;
    globalRole: GlobalRole;
    /** Epoch ms of the user's last password change (0 if never). */
    pwdAt: number;
  }

  interface Session {
    user: {
      id: string;
      username: string;
      globalRole: GlobalRole;
      pwdAt: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    globalRole: GlobalRole;
    pwdAt: number;
  }
}
```

Also update the file's header comment: the JWT now additionally carries the password-change watermark, and `requireUser` compares it against the DB.

- [ ] **Step 4: Carry `pwdAt` through the Auth.js callbacks**

In `src/lib/auth.ts`, add the field to the object returned by `authorize()`:

```ts
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          username: user.username,
          globalRole: user.globalRole,
          pwdAt: user.passwordChangedAt?.getTime() ?? 0,
        };
```

and to both callbacks:

```ts
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.username = user.username;
        token.globalRole = user.globalRole;
        // Watermark: a session is only honoured while this matches or exceeds
        // the user's current passwordChangedAt (checked in requireUser).
        token.pwdAt = user.pwdAt;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.username = token.username;
        session.user.globalRole = token.globalRole;
        session.user.pwdAt = token.pwdAt;
      }
      return session;
    },
```

- [ ] **Step 5: Add the check to `requireUser`**

Replace the body of `requireUser` in `src/lib/permissions.ts`:

```ts
export const requireUser = cache(async (): Promise<User> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AuthorizationError("UNAUTHENTICATED");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  // User could have been deleted since the JWT was issued.
  if (!user) throw new AuthorizationError("UNAUTHENTICATED");
  if (user.status !== "ACTIVE") throw new AuthorizationError("SUSPENDED");

  // A password reset ends every session issued before it. The row is already
  // loaded, so this costs nothing extra. UNAUTHENTICATED (not SUSPENDED) is
  // right here: the account is fine, the session is simply stale, and the
  // existing 401 path already redirects to sign-in.
  const changedAt = user.passwordChangedAt?.getTime() ?? 0;
  if (changedAt > (session.user?.pwdAt ?? 0)) {
    throw new AuthorizationError("UNAUTHENTICATED");
  }

  return user;
});
```

Update the file's header comment (lines 15-16) to say that the same per-request fetch now also enforces password-change revocation.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/permissions.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 7: Verify the whole suite and types**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green. Existing tests that build a fake session may need `pwdAt: 0` added — that is an expected, mechanical fix.

- [ ] **Step 8: Commit**

```bash
git add src/types/next-auth.d.ts src/lib/auth.ts src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "feat(auth): end other sessions when a password is reset"
```

---

### Task 6: Forgot-password page and form

**Files:**
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/features/auth/components/ForgotPasswordForm.tsx`
- Modify: `src/features/auth/components/LoginForm.tsx:105-119`

**Interfaces:**
- Consumes: `requestPasswordReset` (Task 4), `requestPasswordResetSchema` / `RequestPasswordResetInput` (Task 2).
- Produces: the route `/forgot-password`, reached from a link on `/login`.

- [ ] **Step 1: Create the form**

Create `src/features/auth/components/ForgotPasswordForm.tsx`, modelled on `LoginForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  requestPasswordResetSchema,
  type RequestPasswordResetInput,
} from "@/features/auth/schemas";
import { requestPasswordReset } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RequestPasswordResetInput>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = (values: RequestPasswordResetInput) => {
    setFormError(null);
    startTransition(async () => {
      const result = await requestPasswordReset(values);
      if (result.ok) {
        setSubmitted(true);
      } else {
        setFormError(result.error);
      }
    });
  };

  // Deliberately says nothing about whether the address is registered.
  if (submitted) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Check your email
          </h1>
          <p className="text-sm text-muted-foreground">
            If that address belongs to a Flux account, we&apos;ve sent a link to
            reset the password. It works once and expires in an hour.
          </p>
        </div>
        <Link
          href="/login"
          className="text-sm font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Forgot your password?
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a link to set a new one.
        </p>
      </div>

      <FieldGroup>
        <Field data-invalid={!!errors.email || undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <FieldContent>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              aria-invalid={!!errors.email}
              disabled={isPending}
              {...register("email")}
            />
            <FieldError errors={[errors.email]} />
          </FieldContent>
        </Field>
      </FieldGroup>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Sending…" : "Send reset link"}
      </Button>

      <Link
        href="/login"
        className="text-center text-sm text-muted-foreground hover:text-foreground"
      >
        Back to sign in
      </Link>
    </form>
  );
}
```

- [ ] **Step 2: Create the page**

Create `src/app/(auth)/forgot-password/page.tsx`:

```tsx
import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/features/auth/components/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password — Flux",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
```

- [ ] **Step 3: Link it from the login form**

In `src/features/auth/components/LoginForm.tsx`, import `Link` from `next/link` and replace the password `FieldLabel` line so the link sits on the same row:

```tsx
        <Field data-invalid={!!errors.password || undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
```

Leave the rest of the field untouched.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`
Visit `/login` — the "Forgot password?" link appears beside the password label. Click it, submit a **non-existent** address, and confirm the confirmation screen appears and reveals nothing. With SMTP unconfigured, submitting a **real** address logs the link to the server console.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/forgot-password" src/features/auth/components/ForgotPasswordForm.tsx src/features/auth/components/LoginForm.tsx
git commit -m "feat(auth): add forgot-password page and login link"
```

---

### Task 7: Reset-password page and form

**Files:**
- Create: `src/app/(auth)/reset-password/page.tsx`
- Create: `src/features/auth/components/ResetPasswordForm.tsx`

**Interfaces:**
- Consumes: `validateResetToken` and `resetPassword` (Task 4), `setPasswordSchema` / `SetPasswordInput` (already exported from `schemas.ts`).
- Produces: the route `/reset-password?token=…`, the destination of the emailed link.

- [ ] **Step 1: Create the form**

Create `src/features/auth/components/ResetPasswordForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { setPasswordSchema, type SetPasswordInput } from "@/features/auth/schemas";
import { resetPassword } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { token, password: "" },
  });

  const onSubmit = (values: SetPasswordInput) => {
    setFormError(null);
    startTransition(async () => {
      const result = await resetPassword(values);
      if (result.ok) {
        setDone(true);
        router.refresh();
      } else {
        setFormError(result.error);
      }
    });
  };

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Password updated
          </h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ve been signed out everywhere else. Sign in with your new
            password to continue.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Choose a new password
        </h1>
        <p className="text-sm text-muted-foreground">
          At least 10 characters, with a letter and a number.
        </p>
      </div>

      <input type="hidden" {...register("token")} />

      <FieldGroup>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <FieldContent>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              disabled={isPending}
              {...register("password")}
            />
            <FieldError errors={[errors.password]} />
          </FieldContent>
        </Field>
      </FieldGroup>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Create the page**

Create `src/app/(auth)/reset-password/page.tsx`, following the shape of the register page:

```tsx
import type { Metadata } from "next";
import Link from "next/link";

import { validateResetToken } from "@/features/auth/actions";
import { ResetPasswordForm } from "@/features/auth/components/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set a new password — Flux",
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

function InvalidLink() {
  return (
    <div className="flex flex-col gap-3 text-center">
      <h1 className="text-lg font-semibold tracking-tight text-foreground">
        This reset link is invalid
      </h1>
      <p className="text-sm text-muted-foreground">
        It may have expired or already been used. Request a new one to try
        again.
      </p>
      <Link
        href="/forgot-password"
        className="text-sm font-medium text-primary hover:underline"
      >
        Request a new link
      </Link>
    </div>
  );
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;

  if (!token) return <InvalidLink />;

  const { valid } = await validateResetToken(token);
  if (!valid) return <InvalidLink />;

  return <ResetPasswordForm token={token} />;
}
```

- [ ] **Step 3: Walk the whole flow end to end**

Run: `npm run dev`

1. Sign in in one browser profile and leave the session open.
2. In a second profile, go to `/login` → "Forgot password?" → submit that user's email.
3. Copy the reset link from the server console (SMTP unconfigured) or the inbox.
4. Open it, set a new password, confirm the success screen.
5. Sign in with the new password — works.
6. Reload the still-open first session — it must bounce to `/login`.
7. Open the same reset link a second time — the invalid-link page.

- [ ] **Step 4: Full check**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/reset-password" src/features/auth/components/ResetPasswordForm.tsx
git commit -m "feat(auth): add reset-password page and form"
```

---

## Deployment note

`flux.foodverse.io` runs on the shared ICCA EC2 box under pm2 as `flux`. Deploying this needs the migration applied against the box's local Postgres before the app restarts — follow the project's existing deploy script rather than improvising, and reload nginx only if its config changed (it does not here).
