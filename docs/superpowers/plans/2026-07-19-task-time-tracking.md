# Task Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-task time tracking via a live start/stop timer, roll-up totals, and four views (task drawer, project report, dashboard section, admin report).

**Architecture:** A single `TimeEntry` model (running = `endedAt` null), one running timer per user enforced by a DB partial unique index + an auto-stop-previous transaction. Core logic in `features/time/` (Zod-validated Server Actions + grouped-aggregate queries, all permission-checked). Views reuse existing patterns: the drawer `DrawerSection` slot, `ViewTabs`, the dashboard `Panel`/`KpiCard`, and the admin table.

**Tech Stack:** Next.js 16 App Router (async request APIs), React 19, Prisma 7 (`prisma-client` → `src/generated/prisma`), Auth.js v5, Vitest, Tailwind + Base UI.

## Global Constraints

- TypeScript strict — no `any`. Named exports (except page components).
- Zod-validate every Server Action before the DB; authorise on the server via `lib/permissions`. Never trust the client.
- Prisma **migrations only** (`prisma migrate dev`), never `db push`.
- Base UI primitives use `render={<Button/>}` (NOT Radix `asChild`).
- Tailwind tokens only — glass utility, functional colours; orange = accent only.
- Store time as **integer minutes**; display via `formatMinutes` ("2h 30m"). Timer rounds to nearest minute on stop, **minimum 1**.
- **Permissions:** start/stop + log own time = MEMBER+ (own userId only); edit/delete own entry = owner (MEMBER+); edit/delete any entry = project MANAGER or Admin; view total+own = VIEWER+; view **per-user breakdown** = MANAGER or Admin; global report = Admin.
- Aggregates via `groupBy`/`aggregate`, never row-loading. No ActivityLog/notifications for time events.
- `new Date()` is fine in Server Actions (server runtime). Run one focused test with `npx vitest run <path>`.
- `revalidatePath(\`/projects/${projectId}\`, "layout")` after task-scoped time mutations; also `revalidatePath("/", "layout")` so the dashboard timer indicator refreshes.

---

# PART 1 — Data model + core logic

### Task 1: `TimeEntry` model + migration (with partial unique index)

**Files:**
- Modify: `prisma/schema.prisma` (new model; relations on `User` + `Task`)
- Create: `prisma/migrations/<ts>_time_entry/migration.sql` (generated, then hand-edited)

- [ ] **Step 1: Add the model + relations**

Append to `prisma/schema.prisma`:

```prisma
model TimeEntry {
  id        String    @id @default(cuid())
  taskId    String
  userId    String
  startedAt DateTime
  endedAt   DateTime? // null = running
  minutes   Int? // set on stop: round((endedAt-startedAt)/60000), min 1
  note      String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([taskId])
  @@index([userId, endedAt])
}
```

Add the back-relations:
- On `model User { ... }`: `timeEntries TimeEntry[]`
- On `model Task { ... }`: `timeEntries TimeEntry[]`

- [ ] **Step 2: Generate the migration WITHOUT applying**

Run: `npx prisma migrate dev --create-only --name time_entry`
Expected: a new `prisma/migrations/<ts>_time_entry/migration.sql` containing `CREATE TABLE "TimeEntry" ...` and the two `CREATE INDEX` statements.

- [ ] **Step 3: Hand-add the partial unique index to the migration SQL**

Append this line to the end of that `migration.sql` (Prisma can't express a partial unique index in the schema):

```sql
-- One running timer per user (endedAt IS NULL). Belt-and-braces with the
-- auto-stop-previous transaction in startTimer.
CREATE UNIQUE INDEX "TimeEntry_one_running_per_user" ON "TimeEntry"("userId") WHERE "endedAt" IS NULL;
```

- [ ] **Step 4: Apply the migration + regenerate client**

Run: `npx prisma migrate dev --name time_entry`
Expected: applies to `flux_dev`; then explicitly run `npx prisma generate` (the bundled generate can silently no-op — see prior migration notes) so `src/generated/prisma` has `TimeEntry`.

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit 2>&1 | grep -i timeentry || echo OK`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add TimeEntry model + one-running-per-user index"
```

---

### Task 2: `formatMinutes` + `parseDuration` (TDD)

**Files:**
- Create: `src/features/time/format.ts`
- Create: `src/features/time/format.test.ts`

**Interfaces:**
- Produces: `formatMinutes(min: number): string`; `parseDuration(input: string): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/time/format.test.ts
import { describe, expect, it } from "vitest";
import { formatMinutes, parseDuration } from "./format";

describe("formatMinutes", () => {
  it("formats hours + minutes", () => expect(formatMinutes(150)).toBe("2h 30m"));
  it("formats whole hours", () => expect(formatMinutes(120)).toBe("2h"));
  it("formats minutes", () => expect(formatMinutes(45)).toBe("45m"));
  it("zero / negative → 0m", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(-5)).toBe("0m");
  });
});

describe("parseDuration", () => {
  it("parses '2h 30m'", () => expect(parseDuration("2h 30m")).toBe(150));
  it("parses '2h'", () => expect(parseDuration("2h")).toBe(120));
  it("parses '45m'", () => expect(parseDuration("45m")).toBe(45));
  it("parses a bare number as minutes", () => expect(parseDuration("90")).toBe(90));
  it("rejects garbage", () => expect(parseDuration("soon")).toBeNull());
  it("rejects zero/empty", () => {
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/features/time/format.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// src/features/time/format.ts
// Minutes <-> human duration. Shared client + server (no server-only imports).

/** e.g. 150 → "2h 30m", 120 → "2h", 45 → "45m", <=0 → "0m". */
export function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "0m";
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Parse "2h 30m", "2h", "45m", or a bare minute count ("90") into whole minutes.
 * Returns null for anything unparseable or non-positive.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n : null;
  }
  const match = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const minutes = (Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0);
  return minutes > 0 ? minutes : null;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/features/time/format.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/time/format.ts src/features/time/format.test.ts
git commit -m "feat(time): minutes<->duration format helpers"
```

---

### Task 3: Zod schemas

**Files:**
- Create: `src/features/time/schemas.ts`

**Interfaces:**
- Produces: `startTimerSchema` ({taskId}), `updateTimeEntrySchema` ({id, minutes}), `deleteTimeEntrySchema` ({id}); inferred input types.

- [ ] **Step 1: Write**

```ts
// src/features/time/schemas.ts
import { z } from "zod";

const id = z.string().min(1);

export const startTimerSchema = z.object({ taskId: id });
export const updateTimeEntrySchema = z.object({
  id,
  minutes: z.number().int().min(1).max(24 * 60 * 31), // sanity cap: 31 days
});
export const deleteTimeEntrySchema = z.object({ id });

export type StartTimerInput = z.infer<typeof startTimerSchema>;
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;
export type DeleteTimeEntryInput = z.infer<typeof deleteTimeEntrySchema>;
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "time/schemas" || echo OK` → `OK`

```bash
git add src/features/time/schemas.ts
git commit -m "feat(time): time-entry action schemas"
```

---

### Task 4: Timer + entry Server Actions (TDD)

**Files:**
- Create: `src/features/time/actions.ts`
- Create: `src/features/time/actions.test.ts`

**Interfaces:**
- Consumes: schemas (T3), `prisma`, `requireProjectRole`/`requireUser`/`PROJECT_ROLE_ORDER` (permissions).
- Produces:
  - `startTimer(input: StartTimerInput): Promise<ActionResult<{ startedTaskKey: string; stoppedTaskKey: string | null }>>`
  - `stopTimer(): Promise<ActionResult<{ stopped: boolean }>>`
  - `updateTimeEntry(input: UpdateTimeEntryInput): Promise<ActionResult>`
  - `deleteTimeEntry(input: DeleteTimeEntryInput): Promise<ActionResult>`
  - `ActionResult<T>` (same discriminated shape as `features/notifications/actions.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/time/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/permissions", () => {
  class AuthorizationError extends Error {
    readonly code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthorizationError";
      this.code = code;
    }
  }
  return {
    AuthorizationError,
    PROJECT_ROLE_ORDER: { VIEWER: 0, MEMBER: 1, MANAGER: 2 },
    requireProjectRole: vi.fn(),
    requireUser: vi.fn(),
  };
});

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  const prisma: Record<string, unknown> = { task: model(), timeEntry: model(), user: model() };
  // $transaction(fn) runs fn with the same prisma as the tx client.
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireProjectRole, requireUser } from "@/lib/permissions";
import { startTimer, stopTimer, updateTimeEntry } from "./actions";

interface MockModel { findUnique: Mock; findFirst: Mock; create: Mock; update: Mock; delete: Mock }
const db = prisma as unknown as { task: MockModel; timeEntry: MockModel; user: MockModel };
const mockRPR = requireProjectRole as unknown as Mock;
const mockRU = requireUser as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findUnique.mockResolvedValue({ projectId: "p1", key: "OPS-1" });
  db.timeEntry.findFirst.mockResolvedValue(null);
  db.timeEntry.create.mockResolvedValue({ id: "te-new" });
  db.timeEntry.update.mockResolvedValue({});
  mockRPR.mockResolvedValue({ user: { id: "u1" }, role: "MEMBER" });
  mockRU.mockResolvedValue({ id: "u1" });
});

describe("startTimer", () => {
  it("starts a timer for a MEMBER (no prior running)", async () => {
    const res = await startTimer({ taskId: "t1" });
    expect(res).toEqual({ ok: true, data: { startedTaskKey: "OPS-1", stoppedTaskKey: null } });
    expect(db.timeEntry.create).toHaveBeenCalledOnce();
  });

  it("auto-stops a running timer on another task, then starts", async () => {
    db.timeEntry.findFirst.mockResolvedValue({
      id: "te-old",
      startedAt: new Date(Date.now() - 90 * 60000),
      task: { key: "OPS-9" },
    });
    const res = await startTimer({ taskId: "t1" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.stoppedTaskKey).toBe("OPS-9");
    // old timer closed with minutes ~90
    expect(db.timeEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "te-old" },
        data: expect.objectContaining({ minutes: expect.any(Number) }),
      }),
    );
    expect(db.timeEntry.create).toHaveBeenCalledOnce();
  });

  it("rejects a VIEWER", async () => {
    const { AuthorizationError } = await import("@/lib/permissions");
    mockRPR.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    const res = await startTimer({ taskId: "t1" });
    expect(res).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.timeEntry.create).not.toHaveBeenCalled();
  });
});

describe("stopTimer", () => {
  it("closes the running timer with rounded minutes (min 1)", async () => {
    db.timeEntry.findFirst.mockResolvedValue({
      id: "te-run",
      startedAt: new Date(Date.now() - 20 * 1000), // 20s → rounds to 1 min floor
      task: { projectId: "p1" },
    });
    const res = await stopTimer();
    expect(res).toEqual({ ok: true, data: { stopped: true } });
    expect(db.timeEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ minutes: 1 }) }),
    );
  });

  it("no-op when nothing is running", async () => {
    db.timeEntry.findFirst.mockResolvedValue(null);
    const res = await stopTimer();
    expect(res).toEqual({ ok: true, data: { stopped: false } });
    expect(db.timeEntry.update).not.toHaveBeenCalled();
  });
});

describe("updateTimeEntry", () => {
  it("forbids a MEMBER editing someone else's entry", async () => {
    db.timeEntry.findUnique.mockResolvedValue({
      id: "te1", userId: "other", endedAt: new Date(), task: { projectId: "p1" },
    });
    mockRPR.mockResolvedValue({ user: { id: "u1" }, role: "MEMBER" });
    const res = await updateTimeEntry({ id: "te1", minutes: 30 });
    expect(res.ok).toBe(false);
    expect(db.timeEntry.update).not.toHaveBeenCalled();
  });

  it("lets a MANAGER edit anyone's entry", async () => {
    db.timeEntry.findUnique.mockResolvedValue({
      id: "te1", userId: "other", endedAt: new Date(), task: { projectId: "p1" },
    });
    mockRPR.mockResolvedValue({ user: { id: "mgr" }, role: "MANAGER" });
    const res = await updateTimeEntry({ id: "te1", minutes: 30 });
    expect(res.ok).toBe(true);
    expect(db.timeEntry.update).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/features/time/actions.test.ts`
Expected: FAIL (actions not exported).

- [ ] **Step 3: Implement `actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  PROJECT_ROLE_ORDER,
  requireProjectRole,
  requireUser,
} from "@/lib/permissions";
import {
  startTimerSchema,
  updateTimeEntrySchema,
  deleteTimeEntrySchema,
  type StartTimerInput,
  type UpdateTimeEntryInput,
  type DeleteTimeEntryInput,
} from "./schemas";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function mapAuthError(err: unknown): { ok: false; error: string } | null {
  if (err instanceof AuthorizationError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return fail("You must be signed in.");
      case "SUSPENDED":
        return fail("Your account is suspended.");
      case "FORBIDDEN":
        return fail("You don't have permission to do that.");
    }
  }
  return null;
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
}

/**
 * Start a timer on a task (MEMBER+). One running timer per user: any existing
 * running timer is auto-closed first (in the same tx), and its task key is
 * returned so the UI can say "Stopped timer on OPS-9".
 */
export async function startTimer(
  input: StartTimerInput,
): Promise<ActionResult<{ startedTaskKey: string; stoppedTaskKey: string | null }>> {
  const parsed = startTimerSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const task = await prisma.task.findUnique({
      where: { id: parsed.data.taskId },
      select: { projectId: true, key: true },
    });
    if (!task) return fail("Task not found.");
    const { user } = await requireProjectRole(task.projectId, "MEMBER");

    const now = new Date();
    const { stoppedTaskKey } = await prisma.$transaction(async (tx) => {
      const running = await tx.timeEntry.findFirst({
        where: { userId: user.id, endedAt: null },
        select: { id: true, startedAt: true, task: { select: { key: true } } },
      });
      let stoppedTaskKey: string | null = null;
      if (running) {
        await tx.timeEntry.update({
          where: { id: running.id },
          data: { endedAt: now, minutes: minutesBetween(running.startedAt, now) },
        });
        stoppedTaskKey = running.task.key;
      }
      await tx.timeEntry.create({
        data: { taskId: parsed.data.taskId, userId: user.id, startedAt: now },
      });
      return { stoppedTaskKey };
    });

    revalidatePath(`/projects/${task.projectId}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true, data: { startedTaskKey: task.key, stoppedTaskKey } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Stop the signed-in user's running timer (no-op if none). */
export async function stopTimer(): Promise<ActionResult<{ stopped: boolean }>> {
  try {
    const user = await requireUser();
    const running = await prisma.timeEntry.findFirst({
      where: { userId: user.id, endedAt: null },
      select: { id: true, startedAt: true, task: { select: { projectId: true } } },
    });
    if (!running) return { ok: true, data: { stopped: false } };
    const now = new Date();
    await prisma.timeEntry.update({
      where: { id: running.id },
      data: { endedAt: now, minutes: minutesBetween(running.startedAt, now) },
    });
    revalidatePath(`/projects/${running.task.projectId}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true, data: { stopped: true } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Load an entry + authorise the caller to manage it (owner MEMBER+, or MANAGER/Admin). */
async function authorizeManage(entryId: string) {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: { id: true, userId: true, endedAt: true, task: { select: { projectId: true } } },
  });
  if (!entry) return { error: fail("Time entry not found.") } as const;
  const { user, role } = await requireProjectRole(entry.task.projectId, "MEMBER");
  const isOwner = entry.userId === user.id;
  const isManager = PROJECT_ROLE_ORDER[role] >= PROJECT_ROLE_ORDER.MANAGER;
  if (!isOwner && !isManager) return { error: fail("You don't have permission to do that.") } as const;
  return { entry } as const;
}

/** Edit a completed entry's minutes (owner or MANAGER/Admin). */
export async function updateTimeEntry(input: UpdateTimeEntryInput): Promise<ActionResult> {
  const parsed = updateTimeEntrySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const auth = await authorizeManage(parsed.data.id);
    if ("error" in auth) return auth.error;
    if (!auth.entry.endedAt) return fail("Stop the timer before editing it.");
    await prisma.timeEntry.update({
      where: { id: parsed.data.id },
      data: { minutes: parsed.data.minutes },
    });
    revalidatePath(`/projects/${auth.entry.task.projectId}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Delete an entry (owner or MANAGER/Admin). */
export async function deleteTimeEntry(input: DeleteTimeEntryInput): Promise<ActionResult> {
  const parsed = deleteTimeEntrySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const auth = await authorizeManage(parsed.data.id);
    if ("error" in auth) return auth.error;
    await prisma.timeEntry.delete({ where: { id: parsed.data.id } });
    revalidatePath(`/projects/${auth.entry.task.projectId}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}
```

- [ ] **Step 4: Run — expect PASS**, then full suite

Run: `npx vitest run src/features/time/actions.test.ts` → PASS (7 tests)
Run: `npm run test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/features/time/actions.ts src/features/time/actions.test.ts
git commit -m "feat(time): start/stop timer + edit/delete entry actions"
```

---

### Task 5: Read queries — running timer + task time (role-gated) (TDD)

**Files:**
- Create: `src/features/time/queries.ts`
- Create: `src/features/time/queries.test.ts`

**Interfaces:**
- Produces:
  - `getRunningTimer(): Promise<RunningTimer | null>` — `{ id, taskId, taskKey, projectId, startedAt }`.
  - `getTaskTime(taskId: string): Promise<TaskTime>` — `{ totalMinutes, myMinutes, canManage, perUser: PerUserTime[] | null, entries: TimeEntryRow[] }`.
  - Types: `RunningTimer`, `TaskTime`, `PerUserTime = { user: UserBasic, minutes }`, `TimeEntryRow = { id, minutes, startedAt, endedAt, user: UserBasic }`, `UserBasic = {id,name,username,avatarKey}`.
- The role gate: `perUser` is non-null and `entries` include all users ONLY when caller is MANAGER+/Admin; otherwise `perUser: null` and `entries` = caller's own.

- [ ] **Step 1: Write the failing test** (focus on the role gate — the security-critical part)

```ts
// src/features/time/queries.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/permissions", () => ({
  PROJECT_ROLE_ORDER: { VIEWER: 0, MEMBER: 1, MANAGER: 2 },
  requireProjectRole: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const prisma = {
    task: { findUnique: vi.fn() },
    timeEntry: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
  };
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireProjectRole } from "@/lib/permissions";
import { getTaskTime } from "./queries";

const db = prisma as unknown as {
  task: { findUnique: Mock };
  timeEntry: { aggregate: Mock; groupBy: Mock; findMany: Mock };
  user: { findMany: Mock };
};
const mockRPR = requireProjectRole as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findUnique.mockResolvedValue({ projectId: "p1" });
  // total agg, then my agg (aggregate called twice; both return 60)
  db.timeEntry.aggregate.mockResolvedValue({ _sum: { minutes: 60 } });
  db.timeEntry.groupBy.mockResolvedValue([{ userId: "u1", _sum: { minutes: 60 } }]);
  db.user.findMany.mockResolvedValue([{ id: "u1", name: "A", username: "a", avatarKey: null }]);
  db.timeEntry.findMany.mockResolvedValue([]);
});

describe("getTaskTime role gating", () => {
  it("hides per-user breakdown from a MEMBER (perUser null, own entries only)", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u1" }, role: "MEMBER" });
    const res = await getTaskTime("t1");
    expect(res.perUser).toBeNull();
    expect(res.canManage).toBe(false);
    expect(db.timeEntry.groupBy).not.toHaveBeenCalled();
    // entries query scoped to the caller
    expect(db.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "u1" }) }),
    );
  });

  it("gives a MANAGER the per-user breakdown + all entries", async () => {
    mockRPR.mockResolvedValue({ user: { id: "mgr" }, role: "MANAGER" });
    const res = await getTaskTime("t1");
    expect(res.perUser).not.toBeNull();
    expect(res.canManage).toBe(true);
    expect(db.timeEntry.groupBy).toHaveBeenCalledOnce();
    // entries query NOT scoped to a single user
    const call = db.timeEntry.findMany.mock.calls[0][0];
    expect(call.where.userId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/features/time/queries.test.ts`)

- [ ] **Step 3: Implement `queries.ts`**

```ts
import "server-only";

import { prisma } from "@/lib/db";
import { PROJECT_ROLE_ORDER, requireProjectRole, requireUser } from "@/lib/permissions";

const USER_BASIC = { id: true, name: true, username: true, avatarKey: true } as const;
type UserBasic = { id: string; name: string; username: string; avatarKey: string | null };

export interface RunningTimer {
  id: string;
  taskId: string;
  taskKey: string;
  projectId: string;
  startedAt: Date;
}

export interface PerUserTime { user: UserBasic; minutes: number }
export interface TimeEntryRow {
  id: string;
  minutes: number;
  startedAt: Date;
  endedAt: Date | null;
  user: UserBasic;
}
export interface TaskTime {
  totalMinutes: number;
  myMinutes: number;
  canManage: boolean;
  perUser: PerUserTime[] | null;
  entries: TimeEntryRow[];
}

/** The signed-in user's running timer, or null. */
export async function getRunningTimer(): Promise<RunningTimer | null> {
  const user = await requireUser();
  const r = await prisma.timeEntry.findFirst({
    where: { userId: user.id, endedAt: null },
    select: { id: true, taskId: true, startedAt: true, task: { select: { key: true, projectId: true } } },
  });
  return r
    ? { id: r.id, taskId: r.taskId, taskKey: r.task.key, projectId: r.task.projectId, startedAt: r.startedAt }
    : null;
}

/**
 * Time totals for a task. Everyone VIEWER+ sees `totalMinutes` + `myMinutes`.
 * The per-user breakdown + all entries are MANAGER/Admin-only; a member sees
 * `perUser: null` and only their own entries.
 */
export async function getTaskTime(taskId: string): Promise<TaskTime> {
  const empty: TaskTime = { totalMinutes: 0, myMinutes: 0, canManage: false, perUser: null, entries: [] };
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!task) return empty;

  const { user, role } = await requireProjectRole(task.projectId, "VIEWER");
  const canManage = PROJECT_ROLE_ORDER[role] >= PROJECT_ROLE_ORDER.MANAGER;
  const done = { endedAt: { not: null } } as const;

  const [totalAgg, myAgg] = await Promise.all([
    prisma.timeEntry.aggregate({ where: { taskId, ...done }, _sum: { minutes: true } }),
    prisma.timeEntry.aggregate({ where: { taskId, userId: user.id, ...done }, _sum: { minutes: true } }),
  ]);
  const totalMinutes = totalAgg._sum.minutes ?? 0;
  const myMinutes = myAgg._sum.minutes ?? 0;

  let perUser: PerUserTime[] | null = null;
  if (canManage) {
    const grouped = await prisma.timeEntry.groupBy({
      by: ["userId"],
      where: { taskId, ...done },
      _sum: { minutes: true },
    });
    if (grouped.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: grouped.map((g) => g.userId) } },
        select: USER_BASIC,
      });
      const byId = new Map(users.map((u) => [u.id, u]));
      perUser = grouped
        .map((g) => ({ user: byId.get(g.userId)!, minutes: g._sum.minutes ?? 0 }))
        .filter((r) => r.user)
        .sort((a, b) => b.minutes - a.minutes);
    } else {
      perUser = [];
    }
  }

  const entries = await prisma.timeEntry.findMany({
    where: { taskId, ...done, ...(canManage ? {} : { userId: user.id }) },
    orderBy: { startedAt: "desc" },
    select: { id: true, minutes: true, startedAt: true, endedAt: true, user: { select: USER_BASIC } },
  });

  return {
    totalMinutes,
    myMinutes,
    canManage,
    perUser,
    entries: entries.map((e) => ({ ...e, minutes: e.minutes ?? 0 })),
  };
}
```

- [ ] **Step 4: Run — expect PASS** (`npx vitest run src/features/time/queries.test.ts`, 2 tests), then `npm run test` green.

- [ ] **Step 5: Commit**

```bash
git add src/features/time/queries.ts src/features/time/queries.test.ts
git commit -m "feat(time): getRunningTimer + role-gated getTaskTime"
```

---

# PART 2 — Task drawer Time section

### Task 6: `TaskTimeSection` + `TimerButton` components

**Files:**
- Create: `src/features/time/components/TimerButton.tsx`
- Create: `src/features/time/components/TaskTimeSection.tsx`

**Interfaces:**
- Consumes: `startTimer`/`stopTimer`/`updateTimeEntry`/`deleteTimeEntry` (T4), `TaskTime`/`RunningTimer` (T5), `formatMinutes` (T2), `AssigneeAvatar` (`@/features/tasks/components/AssigneeAvatar`), ui `Button`.
- Produces: `TimerButton` (client — live elapsed) and `TaskTimeSection` (client — totals + breakdown + entries), rendered as the child of the drawer's "Time" `DrawerSection`.

- [ ] **Step 1: `TimerButton.tsx` (live elapsed clock)**

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Play, Square } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { startTimer, stopTimer } from "../actions"
import type { RunningTimer } from "../queries"

function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export interface TimerButtonProps {
  taskId: string
  /** The signed-in user's running timer anywhere, or null. */
  running: RunningTimer | null
}

/** Start / stop / switch the current user's timer for THIS task, with a live clock. */
export function TimerButton({ taskId, running }: TimerButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const runningHere = running?.taskId === taskId

  // Live-tick elapsed only while the timer runs on this task.
  const [now, setNow] = React.useState<number>(() => (runningHere ? Date.now() : 0))
  React.useEffect(() => {
    if (!runningHere || !running) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runningHere, running])

  function onStart() {
    startTransition(async () => {
      const res = await startTimer({ taskId })
      if (!res.ok) return toast.error(res.error)
      if (res.data?.stoppedTaskKey) toast.info(`Stopped timer on ${res.data.stoppedTaskKey}`)
      toast.success("Timer started")
      router.refresh()
    })
  }
  function onStop() {
    startTransition(async () => {
      const res = await stopTimer()
      if (!res.ok) return toast.error(res.error)
      toast.success("Timer stopped")
      router.refresh()
    })
  }

  if (runningHere && running) {
    const elapsed = now ? now - new Date(running.startedAt).getTime() : 0
    return (
      <Button size="sm" variant="secondary" onClick={onStop} disabled={isPending} aria-label="Stop timer">
        <Square aria-hidden />
        <span className="tabular-nums">{hms(elapsed)}</span>
      </Button>
    )
  }
  return (
    <Button size="sm" variant="outline" onClick={onStart} disabled={isPending} aria-label="Start timer">
      <Play aria-hidden />
      {running ? "Switch timer here" : "Start timer"}
    </Button>
  )
}
```

- [ ] **Step 2: `TaskTimeSection.tsx` (totals + breakdown + entries)**

```tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { AssigneeAvatar } from "@/features/tasks/components/AssigneeAvatar"
import { deleteTimeEntry } from "../actions"
import { formatMinutes } from "../format"
import type { RunningTimer, TaskTime } from "../queries"
import { TimerButton } from "./TimerButton"

export interface TaskTimeSectionProps {
  taskId: string
  time: TaskTime
  running: RunningTimer | null
  /** MEMBER+ on this project — may log time. */
  canLog: boolean
  currentUserId: string
}

export function TaskTimeSection({ taskId, time, running, canLog, currentUserId }: TaskTimeSectionProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function onDelete(id: string) {
    startTransition(async () => {
      const res = await deleteTimeEntry({ id })
      if (!res.ok) return toast.error(res.error)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {formatMinutes(time.totalMinutes)}
          </span>
          <span className="text-xs text-muted-foreground">
            total · {formatMinutes(time.myMinutes)} by you
          </span>
        </div>
        {canLog ? <TimerButton taskId={taskId} running={running} /> : null}
      </div>

      {time.perUser ? (
        <ul className="flex flex-col gap-1.5">
          {time.perUser.map((r) => (
            <li key={r.user.id} className="flex items-center gap-2 text-sm">
              <AssigneeAvatar user={r.user} />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {r.user.name}{" "}
                <span className="text-muted-foreground">@{r.user.username}</span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatMinutes(r.minutes)}
              </span>
            </li>
          ))}
          {time.perUser.length === 0 ? (
            <li className="text-sm text-muted-foreground">No time logged yet.</li>
          ) : null}
        </ul>
      ) : null}

      {time.entries.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-border pt-2">
          {time.entries.map((e) => {
            const canRemove = time.canManage || e.user.id === currentUserId
            return (
              <li key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums text-foreground">{formatMinutes(e.minutes)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {e.user.name} · {new Date(e.startedAt).toLocaleDateString()}
                </span>
                {canRemove ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => onDelete(e.id)}
                    disabled={isPending}
                    aria-label={`Delete ${formatMinutes(e.minutes)} entry`}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No time logged yet.</p>
      )}
    </div>
  )
}
```

> Note: entry-minutes editing (`updateTimeEntry`) is intentionally not surfaced in v1's drawer UI — delete + re-log covers correction. The action exists for a later inline-edit; leaving it unused here is acceptable (it's used by tests, not dead in the module).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "TimerButton|TaskTimeSection" || echo OK` → `OK`

- [ ] **Step 4: Commit**

```bash
git add src/features/time/components/
git commit -m "feat(time): TaskTimeSection + live TimerButton"
```

---

### Task 7: Slot the Time section into the drawer + thread data

**Files:**
- Modify: `src/features/tasks/components/TaskDrawer.tsx` (add a `time?` slot + render a "Time" DrawerSection)
- Modify: `src/features/tasks/components/TaskDetailPanel.tsx` (accept `taskTime` + `runningTimer`, build the slot)
- Modify: `src/app/(dashboard)/projects/[projectId]/page.tsx` (fetch + pass)

- [ ] **Step 1: Drawer slot**

In `TaskDrawer.tsx` `TaskDrawerProps`, after the `watchers?: React.ReactNode` slot added earlier, add:

```ts
  /** Time-tracking panel (built by the caller). */
  time?: React.ReactNode
```

Destructure `time` alongside `watchers`. In the "Slot sections" area, add a Time section directly after the Watchers section:

```tsx
                <DrawerSection title="Time" emptyText="No time logged yet.">
                  {time}
                </DrawerSection>
```

- [ ] **Step 2: Panel wiring**

In `TaskDetailPanel.tsx`:

```tsx
import { TaskTimeSection } from "@/features/time/components/TaskTimeSection"
import type { RunningTimer, TaskTime } from "@/features/time/queries"
```

Add to its props interface + destructuring:

```tsx
  taskTime: TaskTime
  runningTimer: RunningTimer | null
```

Pass a `time` slot to `<TaskDrawer>` (next to `watchers=`):

```tsx
      time={
        <TaskTimeSection
          taskId={task.id}
          time={taskTime}
          running={runningTimer}
          canLog={canEdit}
          currentUserId={currentUserId}
        />
      }
```

- [ ] **Step 3: Page fetch + pass**

In `src/app/(dashboard)/projects/[projectId]/page.tsx`:

```ts
import { getTaskTime, getRunningTimer } from "@/features/time/queries"
import type { RunningTimer, TaskTime } from "@/features/time/queries"
```

Add `taskTime` + `runningTimer` to the drawer `Promise.all` (the one already fetching `getTaskWatchers(taskId)`), extend the `drawerData` type + object, and pass them to `<TaskDetailPanel>`:

```ts
        const [comments, attachments, activity, isWatching, watchers, taskTime, runningTimer] =
          await Promise.all([
            getComments(taskId),
            getAttachments(taskId),
            getTaskActivity(taskId),
            isWatchingTask(taskId),
            getTaskWatchers(taskId),
            getTaskTime(taskId),
            getRunningTimer(),
          ])
        drawerData = { task, comments, attachments, activity, isWatching, watchers, taskTime, runningTimer }
```

Add `taskTime: TaskTime` and `runningTimer: RunningTimer | null` to the `drawerData` type; pass `taskTime={drawerData.taskTime}` and `runningTimer={drawerData.runningTimer}` to `<TaskDetailPanel>`.

- [ ] **Step 4: Build**

Run: `npm run build 2>&1 | tail -15` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/TaskDrawer.tsx src/features/tasks/components/TaskDetailPanel.tsx "src/app/(dashboard)/projects/[projectId]/page.tsx"
git commit -m "feat(time): show time tracking in the task drawer"
```

---

# PART 3 — Per-project time report (`?view=time` tab)

> Refinement vs spec wording: the report is a third `?view=time` on the existing project page (reusing `ViewTabs` + the page shell), not a separate `/time` route — consistent with how Board/Backlog already work.

### Task 8: `getProjectTimeReport` query (role-gated) (TDD)

**Files:**
- Modify: `src/features/time/queries.ts` (append)
- Modify: `src/features/time/queries.test.ts` (append a gating test)

**Interfaces:**
- Produces: `getProjectTimeReport(projectId): Promise<ProjectTimeReport>` —
  `{ totalMinutes, myMinutes, canManage, byUser: PerUserTime[] | null, byTask: { task: {id,key,title}, minutes }[] | null }`.
  `byUser`/`byTask` are non-null only for MANAGER+/Admin.

- [ ] **Step 1: Append a failing test**

```ts
// add to queries.test.ts — extend the db mock's timeEntry with groupBy already present;
// add task.findMany to the mock: db.task.findMany = vi.fn()
import { getProjectTimeReport } from "./queries";

describe("getProjectTimeReport role gating", () => {
  it("member sees totals only (byUser/byTask null)", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u1" }, role: "MEMBER" });
    db.timeEntry.aggregate.mockResolvedValue({ _sum: { minutes: 120 } });
    const res = await getProjectTimeReport("p1");
    expect(res.byUser).toBeNull();
    expect(res.byTask).toBeNull();
    expect(res.canManage).toBe(false);
  });
});
```

(Extend the `@/lib/db` mock in this file to include `task: { findUnique: vi.fn(), findMany: vi.fn() }` if not already — add `findMany`.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement (append to `queries.ts`)**

```ts
export interface ProjectTaskTime {
  task: { id: string; key: string; title: string };
  minutes: number;
}
export interface ProjectTimeReport {
  totalMinutes: number;
  myMinutes: number;
  canManage: boolean;
  byUser: PerUserTime[] | null;
  byTask: ProjectTaskTime[] | null;
}

/**
 * Project time report. Everyone VIEWER+ gets project total + their own; the
 * by-user and by-task breakdowns are MANAGER/Admin-only.
 */
export async function getProjectTimeReport(projectId: string): Promise<ProjectTimeReport> {
  const { user, role } = await requireProjectRole(projectId, "VIEWER");
  const canManage = PROJECT_ROLE_ORDER[role] >= PROJECT_ROLE_ORDER.MANAGER;
  const where = { task: { projectId }, endedAt: { not: null } } as const;

  const [totalAgg, myAgg] = await Promise.all([
    prisma.timeEntry.aggregate({ where, _sum: { minutes: true } }),
    prisma.timeEntry.aggregate({ where: { ...where, userId: user.id }, _sum: { minutes: true } }),
  ]);

  let byUser: PerUserTime[] | null = null;
  let byTask: ProjectTaskTime[] | null = null;
  if (canManage) {
    const [gu, gt] = await Promise.all([
      prisma.timeEntry.groupBy({ by: ["userId"], where, _sum: { minutes: true } }),
      prisma.timeEntry.groupBy({ by: ["taskId"], where, _sum: { minutes: true } }),
    ]);
    const [users, tasks] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: gu.map((g) => g.userId) } }, select: USER_BASIC }),
      prisma.task.findMany({ where: { id: { in: gt.map((g) => g.taskId) } }, select: { id: true, key: true, title: true } }),
    ]);
    const uById = new Map(users.map((u) => [u.id, u]));
    const tById = new Map(tasks.map((t) => [t.id, t]));
    byUser = gu.map((g) => ({ user: uById.get(g.userId)!, minutes: g._sum.minutes ?? 0 }))
      .filter((r) => r.user).sort((a, b) => b.minutes - a.minutes);
    byTask = gt.map((g) => ({ task: tById.get(g.taskId)!, minutes: g._sum.minutes ?? 0 }))
      .filter((r) => r.task).sort((a, b) => b.minutes - a.minutes);
  }

  return {
    totalMinutes: totalAgg._sum.minutes ?? 0,
    myMinutes: myAgg._sum.minutes ?? 0,
    canManage,
    byUser,
    byTask,
  };
}
```

- [ ] **Step 4: Run — expect PASS**, then commit

```bash
git add src/features/time/queries.ts src/features/time/queries.test.ts
git commit -m "feat(time): getProjectTimeReport (role-gated)"
```

---

### Task 9: Project time report view + `?view=time` tab

**Files:**
- Create: `src/features/time/components/ProjectTimeReport.tsx`
- Create: `src/features/time/components/HoursBar.tsx` (a static, unanimated bar row)
- Modify: `src/app/(dashboard)/projects/[projectId]/ViewTabs.tsx` (add a Time tab)
- Modify: `src/app/(dashboard)/projects/[projectId]/page.tsx` (`?view=time` branch)

- [ ] **Step 1: `HoursBar.tsx`**

```tsx
import { formatMinutes } from "../format"

/** A label + static proportional bar (width only; no animation) + value. */
export function HoursBar({ label, sub, minutes, maxMinutes }: {
  label: string
  sub?: string
  minutes: number
  maxMinutes: number
}) {
  const pct = maxMinutes > 0 ? Math.round((minutes / maxMinutes) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 min-w-0 shrink-0">
        <div className="truncate text-sm text-foreground">{label}</div>
        {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
        {formatMinutes(minutes)}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `ProjectTimeReport.tsx` (server component)**

```tsx
import { formatMinutes } from "../format"
import type { ProjectTimeReport as Report } from "../queries"
import { HoursBar } from "./HoursBar"

export function ProjectTimeReport({ report }: { report: Report }) {
  const maxUser = Math.max(1, ...(report.byUser ?? []).map((r) => r.minutes))
  const maxTask = Math.max(1, ...(report.byTask ?? []).map((r) => r.minutes))
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="glass flex flex-col gap-1 p-5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Project total</span>
          <span className="text-3xl font-semibold tabular-nums text-foreground">
            {formatMinutes(report.totalMinutes)}
          </span>
        </div>
        <div className="glass flex flex-col gap-1 p-5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Logged by you</span>
          <span className="text-3xl font-semibold tabular-nums text-foreground">
            {formatMinutes(report.myMinutes)}
          </span>
        </div>
      </div>

      {report.byUser ? (
        <section className="glass flex flex-col gap-3 p-5">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Hours by user</h2>
          {report.byUser.length === 0 ? (
            <p className="text-sm text-muted-foreground">No time logged yet.</p>
          ) : (
            report.byUser.map((r) => (
              <HoursBar key={r.user.id} label={r.user.name} sub={`@${r.user.username}`} minutes={r.minutes} maxMinutes={maxUser} />
            ))
          )}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only project managers can see the per-user breakdown.
        </p>
      )}

      {report.byTask && report.byTask.length > 0 ? (
        <section className="glass flex flex-col gap-3 p-5">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Hours by task</h2>
          {report.byTask.map((r) => (
            <HoursBar key={r.task.id} label={r.task.key} sub={r.task.title} minutes={r.minutes} maxMinutes={maxTask} />
          ))}
        </section>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Add the Time tab to `ViewTabs.tsx`**

Change the `view` prop type to `"board" | "backlog" | "time"` and add a third `<Link>` after Backlog:

```tsx
      <Link
        href={`/projects/${projectId}?view=time`}
        role="tab"
        aria-selected={view === "time"}
        className={tabClass(view === "time")}
      >
        Time
      </Link>
```

- [ ] **Step 4: `?view=time` branch in `page.tsx`**

- Add the import: `import { getProjectTimeReport } from "@/features/time/queries"` and `import { ProjectTimeReport } from "@/features/time/components/ProjectTimeReport"`.
- Where `view` is derived, widen it:

```ts
  const view: "board" | "backlog" | "time" =
    sp.view === "backlog" ? "backlog" : sp.view === "time" ? "time" : "board"
```

- The `ViewTabs` usage already passes `view`; its type now accepts `"time"`.
- Add a branch (alongside the `if (view === "board") {...} else {...}` for backlog). Restructure to:

```tsx
  if (view === "time") {
    const report = await getProjectTimeReport(projectId)
    viewContent = <ProjectTimeReport report={report} />
  } else if (view === "board") {
    // ...existing board branch...
  } else {
    // ...existing backlog branch...
  }
```

(Keep the existing board/backlog branch bodies unchanged; just wrap them in the new `if/else if/else`.)

- [ ] **Step 5: Build + commit**

Run: `npm run build 2>&1 | tail -15` → succeeds.

```bash
git add src/features/time/components/ProjectTimeReport.tsx src/features/time/components/HoursBar.tsx "src/app/(dashboard)/projects/[projectId]/ViewTabs.tsx" "src/app/(dashboard)/projects/[projectId]/page.tsx"
git commit -m "feat(time): per-project time report (?view=time)"
```

---

# PART 4 — Dashboard "My logged hours" section

### Task 10: `getMyLoggedHours` query (TDD)

**Files:**
- Modify: `src/features/time/queries.ts` (append)
- Modify: `src/features/time/queries.test.ts` (append)

**Interfaces:**
- Produces: `getMyLoggedHours(): Promise<{ thisWeekMinutes: number; byProject: { project: {id,key,name}, minutes }[] }>` — the signed-in user's own completed entries; `thisWeekMinutes` from Monday 00:00 server-local.

- [ ] **Step 1: Append a test**

```ts
import { getMyLoggedHours } from "./queries";
// db mock needs prisma.project.findMany — add project: { findMany: vi.fn() } to the mock,
// and requireUser returns { id: "u1" }.

it("getMyLoggedHours sums this week + groups by project (own only)", async () => {
  (requireUser as unknown as Mock).mockResolvedValue({ id: "u1" });
  db.timeEntry.aggregate.mockResolvedValue({ _sum: { minutes: 200 } });
  db.timeEntry.groupBy.mockResolvedValue([]); // no per-project rows
  const res = await getMyLoggedHours();
  expect(res.thisWeekMinutes).toBe(200);
  expect(res.byProject).toEqual([]);
  // aggregate where is scoped to the caller
  expect(db.timeEntry.aggregate).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ userId: "u1" }) }),
  );
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement (append to `queries.ts`)**

```ts
function startOfIsoWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); // Mon = 0
  return date;
}

export interface MyLoggedHours {
  thisWeekMinutes: number;
  byProject: { project: { id: string; key: string; name: string }; minutes: number }[];
}

/** The signed-in user's own logged time: this-week total + all-time by project. */
export async function getMyLoggedHours(): Promise<MyLoggedHours> {
  const user = await requireUser();
  const weekStart = startOfIsoWeek(new Date());
  const done = { endedAt: { not: null } } as const;

  const [weekAgg, grouped] = await Promise.all([
    prisma.timeEntry.aggregate({
      where: { userId: user.id, ...done, startedAt: { gte: weekStart } },
      _sum: { minutes: true },
    }),
    prisma.timeEntry.groupBy({
      by: ["taskId"],
      where: { userId: user.id, ...done },
      _sum: { minutes: true },
    }),
  ]);

  // Roll the per-task sums up to per-project.
  let byProject: MyLoggedHours["byProject"] = [];
  if (grouped.length > 0) {
    const tasks = await prisma.task.findMany({
      where: { id: { in: grouped.map((g) => g.taskId) } },
      select: { id: true, project: { select: { id: true, key: true, name: true } } },
    });
    const projByTask = new Map(tasks.map((t) => [t.id, t.project]));
    const acc = new Map<string, { project: { id: string; key: string; name: string }; minutes: number }>();
    for (const g of grouped) {
      const project = projByTask.get(g.taskId);
      if (!project) continue;
      const cur = acc.get(project.id) ?? { project, minutes: 0 };
      cur.minutes += g._sum.minutes ?? 0;
      acc.set(project.id, cur);
    }
    byProject = [...acc.values()].sort((a, b) => b.minutes - a.minutes);
  }

  return { thisWeekMinutes: weekAgg._sum.minutes ?? 0, byProject };
}
```

- [ ] **Step 4: Run — expect PASS**, commit

```bash
git add src/features/time/queries.ts src/features/time/queries.test.ts
git commit -m "feat(time): getMyLoggedHours for the dashboard"
```

---

### Task 11: Dashboard "My logged hours" panel

**Files:**
- Create: `src/features/time/components/MyLoggedHours.tsx`
- Modify: `src/app/(dashboard)/dashboard/page.tsx` (fetch + render a Panel)

- [ ] **Step 1: `MyLoggedHours.tsx`**

```tsx
import { formatMinutes } from "../format"
import type { MyLoggedHours as Data } from "../queries"

export function MyLoggedHours({ data }: { data: Data }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-2xl font-semibold tabular-nums text-foreground">
          {formatMinutes(data.thisWeekMinutes)}
        </div>
        <div className="text-xs text-muted-foreground">logged this week</div>
      </div>
      {data.byProject.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {data.byProject.map((r) => (
            <li key={r.project.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-foreground">
                <span className="font-mono text-xs text-muted-foreground">{r.project.key}</span>{" "}
                {r.project.name}
              </span>
              <span className="tabular-nums text-muted-foreground">{formatMinutes(r.minutes)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No time logged yet.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into the dashboard**

In `src/app/(dashboard)/dashboard/page.tsx`:
- Import: `import { getMyLoggedHours } from "@/features/time/queries"` and `import { MyLoggedHours } from "@/features/time/components/MyLoggedHours"`.
- Add `getMyLoggedHours()` to the big `Promise.all` and destructure it as `loggedHours` (append at the end of the array + destructure list to preserve order).
- Render a `Panel` in the right-hand column (after the Inbox panel):

```tsx
            <Panel title="My logged hours" scope="you">
              <MyLoggedHours data={loggedHours} />
            </Panel>
```

- [ ] **Step 3: Build + commit**

Run: `npm run build 2>&1 | tail -15` → succeeds.

```bash
git add src/features/time/components/MyLoggedHours.tsx "src/app/(dashboard)/dashboard/page.tsx"
git commit -m "feat(time): 'My logged hours' dashboard section"
```

---

# PART 5 — Admin global time report

### Task 12: `getGlobalTimeReport` query (Admin) (TDD)

**Files:**
- Modify: `src/features/time/queries.ts` (append)
- Modify: `src/features/time/queries.test.ts` (append)

**Interfaces:**
- Produces: `getGlobalTimeReport(): Promise<{ totalMinutes: number; byUser: PerUserTime[] }>` — Admin-only (`requireAdmin`), across all projects.

- [ ] **Step 1: Append a test**

```ts
// extend the permissions mock to export requireAdmin: vi.fn()
import { getGlobalTimeReport } from "./queries";

it("getGlobalTimeReport requires admin + returns by-user totals", async () => {
  const { requireAdmin } = await import("@/lib/permissions");
  (requireAdmin as unknown as Mock).mockResolvedValue({ id: "admin" });
  db.timeEntry.aggregate.mockResolvedValue({ _sum: { minutes: 500 } });
  db.timeEntry.groupBy.mockResolvedValue([{ userId: "u1", _sum: { minutes: 500 } }]);
  db.user.findMany.mockResolvedValue([{ id: "u1", name: "A", username: "a", avatarKey: null }]);
  const res = await getGlobalTimeReport();
  expect(res.totalMinutes).toBe(500);
  expect(res.byUser[0]?.minutes).toBe(500);
});
```

Add `requireAdmin: vi.fn()` to the `@/lib/permissions` mock at the top of the test file.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement (append to `queries.ts`)**

Add `requireAdmin` to the permissions import at the top of `queries.ts`:
```ts
import { PROJECT_ROLE_ORDER, requireAdmin, requireProjectRole, requireUser } from "@/lib/permissions";
```

```ts
export interface GlobalTimeReport {
  totalMinutes: number;
  byUser: PerUserTime[];
}

/** Cross-project time totals by user. Admin-only. */
export async function getGlobalTimeReport(): Promise<GlobalTimeReport> {
  await requireAdmin();
  const done = { endedAt: { not: null } } as const;
  const [totalAgg, grouped] = await Promise.all([
    prisma.timeEntry.aggregate({ where: done, _sum: { minutes: true } }),
    prisma.timeEntry.groupBy({ by: ["userId"], where: done, _sum: { minutes: true } }),
  ]);
  let byUser: PerUserTime[] = [];
  if (grouped.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: USER_BASIC,
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    byUser = grouped
      .map((g) => ({ user: byId.get(g.userId)!, minutes: g._sum.minutes ?? 0 }))
      .filter((r) => r.user)
      .sort((a, b) => b.minutes - a.minutes);
  }
  return { totalMinutes: totalAgg._sum.minutes ?? 0, byUser };
}
```

- [ ] **Step 4: Run — expect PASS**, then `npm run test` green. Commit.

```bash
git add src/features/time/queries.ts src/features/time/queries.test.ts
git commit -m "feat(time): getGlobalTimeReport (admin)"
```

---

### Task 13: Admin time report page + nav link

**Files:**
- Create: `src/app/(dashboard)/admin/time/page.tsx`
- Modify: `src/features/admin/components/AdminNav.tsx` (add a "Time" tab to the `TABS` array).

- [ ] **Step 1: Admin page**

```tsx
// src/app/(dashboard)/admin/time/page.tsx
import { getGlobalTimeReport } from "@/features/time/queries"
import { formatMinutes } from "@/features/time/format"
import { HoursBar } from "@/features/time/components/HoursBar"

export default async function AdminTimePage() {
  const report = await getGlobalTimeReport() // requireAdmin() inside — throws for non-admins
  const max = Math.max(1, ...report.byUser.map((r) => r.minutes))
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Time logged across all projects, by user.
      </p>
      <div className="glass flex flex-col gap-1 p-5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Total logged</span>
        <span className="text-3xl font-semibold tabular-nums text-foreground">
          {formatMinutes(report.totalMinutes)}
        </span>
      </div>
      <section className="glass flex flex-col gap-3 p-5">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Hours by user</h2>
        {report.byUser.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time logged yet.</p>
        ) : (
          report.byUser.map((r) => (
            <HoursBar key={r.user.id} label={r.user.name} sub={`@${r.user.username}`} minutes={r.minutes} maxMinutes={max} />
          ))
        )}
      </section>
    </div>
  )
}
```

(`/admin/*` is already ADMIN-gated in `proxy.ts`; `requireAdmin()` inside the query is the real server check.)

- [ ] **Step 2: Add the nav tab**

In `src/features/admin/components/AdminNav.tsx`, add an entry to the `TABS` array (after `/admin/audit`):

```ts
  { href: "/admin/time", label: "Time" },
```

- [ ] **Step 3: Build + commit**

Run: `npm run build 2>&1 | tail -15` → succeeds.

```bash
git add "src/app/(dashboard)/admin/time/page.tsx" <the-nav-file>
git commit -m "feat(time): admin global time report"
```

---

# Final verification

- [ ] **Full test suite** — `npm run test` → all pass (new: format, actions, queries gating).
- [ ] **Lint + build** — `npm run lint && npm run build` → clean.
- [ ] **Manual smoke** (`npm run dev`):
  1. Open a task as MEMBER → Time section → Start timer → live clock ticks; open another task → Start → toast "Stopped timer on <key>"; Stop → total updates.
  2. As MEMBER on a task with others' time → see total + "by you", NO per-user list; as MANAGER → see per-user breakdown + all entries + delete controls.
  3. Project `?view=time` → member sees totals only; manager sees hours-by-user + by-task.
  4. Dashboard → "My logged hours" shows this week + by project.
  5. `/admin/time` (as admin) → hours by user; as non-admin → redirected to /dashboard.

---

## Notes for the implementer
- Reuse `AssigneeAvatar` for user avatars; don't build a new one.
- The live clock is the only animation — client-only, text content, cleaned up on unmount; it never gates data fetching or first paint.
- Keep every aggregate as `groupBy`/`aggregate` — never load entry rows to sum them.
- `requireProjectRole(projectId, "MEMBER")` throws for VIEWER, which correctly blocks VIEWERs from logging/managing time; the query paths use `"VIEWER"` so viewers can still see totals.
