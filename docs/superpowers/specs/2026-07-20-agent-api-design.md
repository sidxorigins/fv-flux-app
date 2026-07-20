# Design — Agent API (`/api/v1`)

Date: 2026-07-20
Branch: `feat/agent-api`

A token-authenticated REST API so external Claude agents can create tasks and log
time programmatically. Deliverable: the endpoints + an `API.md` reference to hand to
agents.

---

## Locked decisions
- **Auth:** API key as `Authorization: Bearer flux_sk_…`. New `ApiKey` model, **hashed
  at rest** (sha256). Key shown **once** at creation. Revocable; `lastUsedAt` tracked.
- **Scope: GLOBAL.** A valid key may act on **any project** (no per-project membership
  check) — a service credential. Because it escalates, **only a global Admin can mint
  keys**, and every mint/revoke is written to the AuditLog.
- **Actor identity:** each key carries an `actor` user. All writes are attributed to
  that user (task `reporterId`, `TimeEntry.userId`, default assignee) — DB writes need a
  real user behind them. The actor's own role does NOT limit the key (scope is global).
- **Endpoints:** list projects, list tasks, create task, log time (completed entry),
  start/stop/running timer.
- **Time:** start/stop timer (one running per actor user) **plus** a completed-log
  endpoint (`POST /api/v1/time`) that writes a finished entry directly — concurrency-safe
  for parallel agents (no timer state, no one-running-per-user contention).
- **Management:** Admin-only `/admin/api-keys` UI (create / list / revoke) + a mint
  **script** for immediate use.
- Basic per-key **rate limiting**; HTTPS only; keys never logged.

## Non-goals (v1)
- Per-project-scoped keys, OAuth, webhooks/outbound, pagination cursors on the list
  endpoints (a sane cap instead), updating/deleting tasks via API, comments/attachments
  via API.

---

## Data model

New Prisma model:

```prisma
model ApiKey {
  id          String    @id @default(cuid())
  name        String            // human label, e.g. "claude-agent-1"
  prefix      String    @unique // shown for identification, e.g. "flux_sk_AbCd1234"
  keyHash     String    @unique // sha256(fullKey), hex
  userId      String            // actor — writes attributed to this user
  createdById String            // admin who minted it
  lastUsedAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())

  user      User @relation("ApiKeyActor", fields: [userId], references: [id], onDelete: Cascade)
  createdBy User @relation("ApiKeyCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  @@index([userId])
}
```

- `User` gains `apiKeys ApiKey[] @relation("ApiKeyActor")` and
  `apiKeysCreated ApiKey[] @relation("ApiKeyCreatedBy")`.
- Migration adds the table (additive).

## Key format & crypto (`lib/api-key.ts`)
- `generateApiKey()` → `{ key, prefix, keyHash }`:
  - `key = "flux_sk_" + base64url(randomBytes(24))` (~32 url-safe chars of entropy).
  - `prefix = key.slice(0, 16)` (`"flux_sk_" + 8`) — stored + shown in the list.
  - `keyHash = sha256(key)` hex.
- `hashApiKey(key)` → sha256 hex (used to look up on each request).
- Pure `node:crypto`; unit-tested (format, hash determinism, prefix).

## API auth (`lib/api-auth.ts`)
- `authenticateApiKey(request): Promise<{ actor: User } | ApiAuthError>`:
  1. Read `Authorization: Bearer <key>`; missing/malformed → 401.
  2. `hashApiKey(key)` → `prisma.apiKey.findUnique({ where: { keyHash } })`. Not found → 401.
     (Lookup by hash is the constant-time-safe comparison — the raw key is never compared.)
  3. `revokedAt != null` → 401. Load actor; actor `status != ACTIVE` → 403.
  4. Best-effort `lastUsedAt` touch (fire-and-forget; never blocks the response).
  5. Rate-limit by key prefix (see below); over limit → 429.
  - Returns the actor user (global scope — no project membership check).
- Route handlers call this first and short-circuit on the error's status.
- `ApiAuthError = { status: 401|403|429, code, message }`.

## Rate limiting (`lib/rate-limit.ts`)
- Simple in-memory fixed-window counter keyed by ApiKey prefix (e.g. 120 req / 60s).
- Best-effort, per-instance (documented as such — not a distributed limiter). Returns
  `{ ok, retryAfter }`. Auth endpoints already out of scope here; this guards `/api/v1`.

## Shared service layer (no session — reused by API and UI)
- `features/time/service.ts` (new): pure DB operations taking an explicit `userId`:
  - `startTimerForUser(userId, taskId)` — the auto-stop-then-create tx (extracted from
    the existing `startTimer` action).
  - `stopTimerForUser(userId)` — close the running entry.
  - `logTimeForUser(userId, taskId, minutes, opts?)` — insert a **completed** entry
    (`startedAt = spentAt ?? now − minutes`, `endedAt = spentAt ?? now`, `minutes`).
  - `getRunningForUser(userId)` — the running entry or null.
  - The existing `startTimer`/`stopTimer` **Server Actions refactor to call these** after
    their own session auth — one implementation, no divergence. Existing action tests
    must stay green.
- `features/tasks/service.ts` (new): `createTaskCore(actorId, input)` — the key-minting +
  position + insert + "created" ActivityLog kernel, extracted so both the existing
  `createTask` action and the API share it. Keep `createTask`'s richer behaviour (labels,
  parent) in the action; the API create uses the kernel with a minimal input set.

## Endpoints (`app/api/v1/**/route.ts`)

All: authenticate first; validate body/query with Zod; JSON in/out; errors as
`{ error, code }` with the right status. A shared `lib/api-response.ts` provides
`apiOk(data, init?)` / `apiError(status, code, message)`.

- `GET /api/v1/projects` → `{ projects: [{ id, key, name }] }` (all projects, capped 200).
- `GET /api/v1/tasks?projectId=<id>&status=<opt>` → `{ tasks: [{ id, key, title, status, priority }] }`
  (top-level tasks in the project, capped 200; 404 if project missing).
- `POST /api/v1/tasks` body `{ projectId, title, type?, priority?, assigneeId?, description? }`
  → `201 { task: { id, key, title, status, priority, assigneeId } }`.
  - Validate project exists; `assigneeId` (if given) is a real user; sanitise
    `description` server-side (`lib/sanitize`); reporter = actor. Reuses `createTaskCore`.
- `POST /api/v1/time` body `{ taskId, minutes, note?, spentAt? }`
  → `201 { entry: { id, taskId, minutes } }`. Completed entry via `logTimeForUser`.
  `minutes` 1–1440·31; `spentAt` optional ISO date. **Concurrency-safe** (no timer state).
- `POST /api/v1/time/start` body `{ taskId }` → `{ started, stoppedTaskKey }`
  (`startTimerForUser`).
- `POST /api/v1/time/stop` → `{ stopped }` (`stopTimerForUser`).
- `GET /api/v1/time/running` → `{ running: { taskId, taskKey, startedAt } | null }`.

Zod schemas colocated in `features/api/schemas.ts`; reused for validation + typing.

## Admin management

- `features/admin/api-keys/` — Zod (`createApiKeySchema { name, userId }`), actions,
  queries:
  - `createApiKey({ name, userId })` — Admin only; generates the key, stores
    `{name, prefix, keyHash, userId, createdById}`, writes an AuditLog
    (`api_key.created`, never storing the raw key), returns the **plaintext key once**.
  - `revokeApiKey(id)` — Admin only; sets `revokedAt`; AuditLog `api_key.revoked`.
  - `listApiKeys()` — Admin only; `{ id, name, prefix, actorName, lastUsedAt, revokedAt, createdAt }`
    (never the hash).
- UI `app/(dashboard)/admin/api-keys/page.tsx` (Admin-gated by `proxy.ts` + `requireAdmin`):
  create dialog (pick actor user + name → shows the key once with a copy button + a
  "you won't see it again" warning), a table (name · prefix · actor · last used · status),
  revoke action. New `AdminNav` tab "API keys".
- Mint **script** `scripts/mint-api-key.mjs` (run on the box like the seed): args
  `--email <actor> --name <label>`, prints the key once. For handing an agent a key today.

## Security requirements
- Keys hashed (sha256) at rest; the raw key exists only in the create response / script
  output — never stored, never logged, never in the AuditLog metadata.
- Minting + revoking are **Admin-only**, re-checked server-side, audited.
- Global scope is deliberate and documented; blast radius mitigated by admin-only
  minting, revocation, `lastUsedAt` visibility, and rate limiting.
- Every endpoint Zod-validates input; `description` sanitised before persist.
- HTTPS only (prod already TLS); `proxy.ts` must let `/api/v1/*` through to its own
  bearer auth (like `/api/cron`) — NOT redirect to /login.
- 401 (no/invalid key), 403 (suspended actor), 429 (rate limited), 400 (bad input),
  404 (missing project/task) — never leak whether a key exists vs is revoked beyond 401.

## Tests
- `lib/api-key`: format, hash determinism, prefix extraction.
- `lib/api-auth`: missing/invalid/revoked key → correct status; valid → actor; suspended
  actor → 403.
- `createApiKey`/`revokeApiKey`: Admin-only (non-admin → forbidden); audit written; hash
  stored not raw.
- `features/time/service`: `logTimeForUser` minutes rounding/insert; `startTimerForUser`
  auto-stop; existing timer-action tests still pass after the refactor.
- Endpoint handlers: unauth → 401; create task returns a key; log time inserts an entry;
  global scope lets the actor act outside their own memberships.

## `proxy.ts` change
`isPublicPath` currently lets `/api/cron` bypass the session gate. Add `/api/v1` the same
way (it authenticates itself via the bearer key inside each handler). Without this, the
proxy would 302 API calls to `/login`.

## Deliverable — `API.md`
Root `API.md`: base URL (`https://flux.foodverse.io/api/v1`), the `Authorization: Bearer`
header, each endpoint with request/response JSON + a `curl` example, error codes, rate
limit, and a "how to get a key" line (ask an admin / the mint script). This is the file
handed to agents.

## Sequencing (build parts)
1. Model + migration + `lib/api-key` crypto + tests. **[migration here]**
2. `lib/api-auth` + `lib/rate-limit` + `lib/api-response` + tests.
3. `proxy.ts` allow `/api/v1`.
4. Shared services: `features/time/service.ts` (+ refactor timer actions) and
   `features/tasks/service.ts` `createTaskCore` (+ refactor createTask). Tests green.
5. Endpoints: projects, tasks (GET+POST), time (log, start, stop, running).
6. Admin: api-key Zod/actions/queries + audit + tests.
7. Admin UI page + create-dialog (show-once) + AdminNav tab.
8. Mint script.
9. `API.md`.
