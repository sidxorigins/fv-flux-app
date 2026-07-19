# Task Watchers, Audit Target Labels, Assignee Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let project MEMBER/MANAGER add other members as task watchers; show human names (not cuids) in the admin audit log Target column; and upgrade the backlog/board Assignee filter with unassigned, assigned-to-me, @username, and multi-select.

**Architecture:** Three independent parts, each its own commits. Part A adds two Server Actions + a query + a client `WatchersSection` slotted into the existing task drawer, plus one enum migration. Part B extracts a pure `buildTargetLabel` helper and batches target lookups inside `getAuditLog`. Part C changes the shared `taskFilterWhere` from a single `assigneeId` to `assigneeIds[] + includeUnassigned`, threads it through the project page's param parsing, and replaces the single assignee `Select` with a multi-select checkbox popover.

**Tech Stack:** Next.js 16 App Router (async request APIs), React 19, Prisma 7 (`prisma-client` generator → `src/generated/prisma`), Auth.js v5, Vitest, Tailwind + shadcn/ui (Base UI primitives), Zod.

## Global Constraints

- TypeScript strict — no `any`. Named exports (except page components).
- Validate every Server Action input with Zod before touching the DB; authorise on the server via `lib/permissions` helpers — never trust the client.
- Prisma **migrations only** (`prisma migrate dev`), never `db push`.
- Tailwind tokens only — never hardcode hex; use the theme tokens/`glass` utility.
- Tests target logic (permissions, filter building, label resolution) — Vitest.
- Run a single test file with: `npx vitest run <path>`.
- `revalidatePath(\`/projects/${projectId}\`, "layout")` after task-scoped mutations (matches existing actions).
- Activity/notification side-effects are best-effort and must never throw out of the action.

---

# PART A — Task Watchers (add others)

`TaskWatcher` already exists (`@@unique([taskId, userId])`), so the feature needs **no table change** — only a new `NotificationType` enum value. Self-watch (`toggleWatchTask`) stays untouched.

### Task A1: Migration — add `TASK_WATCHER_ADDED` notification type

**Files:**
- Modify: `prisma/schema.prisma` (enum `NotificationType`, ~line 275)
- Create: `prisma/migrations/<timestamp>_task_watcher_added_notification/migration.sql` (generated)

- [ ] **Step 1: Add the enum value to the schema**

In `prisma/schema.prisma`, the `NotificationType` enum becomes:

```prisma
enum NotificationType {
  TASK_ASSIGNED
  TASK_COMMENTED
  TASK_MENTIONED
  TASK_STATUS_CHANGED
  TASK_WATCHER_ADDED
}
```

- [ ] **Step 2: Create + apply the migration**

Run: `npx prisma migrate dev --name task_watcher_added_notification`
Expected: a new migration folder is created containing
`ALTER TYPE "NotificationType" ADD VALUE 'TASK_WATCHER_ADDED';`, it applies to `flux_dev`, and the Prisma client regenerates into `src/generated/prisma`.

(Local Postgres `flux_dev` — see memory `local-dev-db-setup`. If migrate can't reach a remote registry that's fine; this migration only touches the local DB.)

- [ ] **Step 3: Verify the client picked up the value**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -5`
Expected: no error about `TASK_WATCHER_ADDED` missing from the enum type.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/generated/prisma
git commit -m "feat(db): add TASK_WATCHER_ADDED notification type"
```

---

### Task A2: Watcher action Zod schema

**Files:**
- Create: `src/features/notifications/schemas.ts`

**Interfaces:**
- Produces: `watcherActionSchema` (Zod object `{ taskId: string, userId: string }`), `WatcherActionInput` type.

- [ ] **Step 1: Write the schema**

```ts
// src/features/notifications/schemas.ts
import { z } from "zod";

const id = z.string().min(1);

/** Input for addTaskWatcher / removeTaskWatcher. */
export const watcherActionSchema = z.object({
  taskId: id,
  userId: id,
});

export type WatcherActionInput = z.infer<typeof watcherActionSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep schemas.ts || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/features/notifications/schemas.ts
git commit -m "feat(watchers): add watcher action schema"
```

---

### Task A3: `getTaskWatchers` query

**Files:**
- Modify: `src/features/notifications/queries.ts`

**Interfaces:**
- Consumes: `prisma`, `USER_BASIC` (already in file), `requireProjectRole` (import to add).
- Produces: `getTaskWatchers(taskId: string): Promise<TaskWatcherItem[]>`, `TaskWatcherItem = { id, name, username, avatarKey }`.

- [ ] **Step 1: Update the imports**

At the top of `src/features/notifications/queries.ts`, change the permissions import to also bring in `requireProjectRole`:

```ts
import { requireProjectRole, requireUser } from "@/lib/permissions";
```

- [ ] **Step 2: Append the query + type at the end of the file**

```ts
export interface TaskWatcherItem {
  id: string;
  name: string;
  username: string;
  avatarKey: string | null;
}

/**
 * The users watching a task (oldest first). VIEWER+ on the task's project.
 * Returns [] for a missing task — mirrors getTaskActivity (nothing to show,
 * nothing leaked).
 */
export async function getTaskWatchers(taskId: string): Promise<TaskWatcherItem[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) return [];

  await requireProjectRole(task.projectId, "VIEWER");

  const rows = await prisma.taskWatcher.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: { user: { select: USER_BASIC } },
  });
  return rows.map((r) => r.user);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep queries.ts || echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/features/notifications/queries.ts
git commit -m "feat(watchers): add getTaskWatchers query"
```

---

### Task A4: `addTaskWatcher` + `removeTaskWatcher` actions (TDD)

**Files:**
- Modify: `src/features/notifications/actions.ts`
- Create: `src/features/notifications/actions.test.ts`

**Interfaces:**
- Consumes: `watcherActionSchema` (A2), `requireProjectRole`, `getProjectRole`, `PROJECT_ROLE_ORDER` (permissions), `notify` (`./service`), `prisma`.
- Produces:
  - `addTaskWatcher(input: WatcherActionInput): Promise<ActionResult<{ added: boolean }>>`
  - `removeTaskWatcher(input: WatcherActionInput): Promise<ActionResult<{ removed: boolean }>>`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/notifications/actions.test.ts
// addTaskWatcher / removeTaskWatcher permission + behaviour. Mocks mirror
// comments/actions.test.ts: @/lib/db is a hand-rolled prisma mock; permissions
// and the notify side-effect are stubbed.
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
    getProjectRole: vi.fn(),
  };
});

vi.mock("@/features/notifications/service", () => ({ notify: vi.fn() }));

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    task: model(),
    taskWatcher: model(),
    activityLog: model(),
    user: model(),
  };
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireProjectRole, getProjectRole } from "@/lib/permissions";
import { addTaskWatcher, removeTaskWatcher } from "./actions";

interface MockModel { findUnique: Mock; upsert: Mock; delete: Mock; create: Mock }
const db = prisma as unknown as {
  task: MockModel; taskWatcher: MockModel; activityLog: MockModel; user: MockModel;
};
const mockRPR = requireProjectRole as unknown as Mock;
const mockGPR = getProjectRole as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findUnique.mockResolvedValue({ projectId: "p1" });
  db.user.findUnique.mockResolvedValue({ name: "Jane Doe" });
  db.taskWatcher.findUnique.mockResolvedValue({ id: "w1" });
  db.taskWatcher.upsert.mockResolvedValue({});
  db.taskWatcher.delete.mockResolvedValue({});
  db.activityLog.create.mockResolvedValue({});
});

describe("addTaskWatcher", () => {
  it("adds a project member as watcher (MEMBER+)", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u-actor" }, role: "MEMBER" });
    mockGPR.mockResolvedValue("MEMBER"); // target is a member
    const res = await addTaskWatcher({ taskId: "t1", userId: "u-target" });
    expect(res).toEqual({ ok: true, data: { added: true } });
    expect(db.taskWatcher.upsert).toHaveBeenCalledOnce();
    expect(db.activityLog.create).toHaveBeenCalledOnce();
  });

  it("rejects a non-member target", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u-actor" }, role: "MEMBER" });
    mockGPR.mockResolvedValue(null); // target has no membership
    const res = await addTaskWatcher({ taskId: "t1", userId: "u-outsider" });
    expect(res.ok).toBe(false);
    expect(db.taskWatcher.upsert).not.toHaveBeenCalled();
  });

  it("propagates FORBIDDEN for a VIEWER", async () => {
    const { AuthorizationError } = await import("@/lib/permissions");
    mockRPR.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    const res = await addTaskWatcher({ taskId: "t1", userId: "u-target" });
    expect(res).toEqual({ ok: false, error: "You don't have permission to do that." });
  });
});

describe("removeTaskWatcher", () => {
  it("lets a VIEWER remove themselves", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u-self" }, role: "VIEWER" });
    const res = await removeTaskWatcher({ taskId: "t1", userId: "u-self" });
    expect(res).toEqual({ ok: true, data: { removed: true } });
    expect(db.taskWatcher.delete).toHaveBeenCalledOnce();
  });

  it("forbids a VIEWER removing someone else", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u-self" }, role: "VIEWER" });
    const res = await removeTaskWatcher({ taskId: "t1", userId: "u-other" });
    expect(res.ok).toBe(false);
    expect(db.taskWatcher.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/notifications/actions.test.ts`
Expected: FAIL — `addTaskWatcher`/`removeTaskWatcher` are not exported yet.

- [ ] **Step 3: Update imports in `actions.ts`**

In `src/features/notifications/actions.ts`, extend the permissions import and add two module imports:

```ts
import {
  AuthorizationError,
  getProjectRole,
  PROJECT_ROLE_ORDER,
  requireProjectRole,
  requireUser,
} from "@/lib/permissions";
import { notify } from "./service";
import { watcherActionSchema, type WatcherActionInput } from "./schemas";
```

- [ ] **Step 4: Append the two actions to `actions.ts`**

```ts
/**
 * Add another project member as a watcher (MEMBER+). The target must belong to
 * the task's project. Idempotent; notifies the added user and logs activity with
 * a NAME snapshot (never the id, so the activity reads "added Jane Doe as watcher").
 */
export async function addTaskWatcher(
  input: WatcherActionInput,
): Promise<ActionResult<{ added: boolean }>> {
  const parsed = watcherActionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const { taskId, userId } = parsed.data;
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) return fail("Task not found.");

    const { user } = await requireProjectRole(task.projectId, "MEMBER");

    const targetRole = await getProjectRole(userId, task.projectId);
    if (!targetRole) return fail("That user isn't a member of this project.");

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    if (!target) return fail("User not found.");

    await prisma.taskWatcher.upsert({
      where: { taskId_userId: { taskId, userId } },
      update: {},
      create: { taskId, userId },
    });
    await prisma.activityLog.create({
      data: {
        taskId,
        actorId: user.id,
        action: "watcher_added",
        field: "watcher",
        newValue: target.name,
      },
    });
    await notify({
      recipientIds: [userId],
      actorId: user.id,
      type: "TASK_WATCHER_ADDED",
      taskId,
    });
    revalidatePath(`/projects/${task.projectId}`, "layout");
    return { ok: true, data: { added: true } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/**
 * Remove a watcher. Allowed for MEMBER+ (any watcher) or for the signed-in user
 * removing themselves. Logs activity with the removed user's name snapshot.
 */
export async function removeTaskWatcher(
  input: WatcherActionInput,
): Promise<ActionResult<{ removed: boolean }>> {
  const parsed = watcherActionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const { taskId, userId } = parsed.data;
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) return fail("Task not found.");

    const { user, role } = await requireProjectRole(task.projectId, "VIEWER");
    const isSelf = userId === user.id;
    if (!isSelf && PROJECT_ROLE_ORDER[role] < PROJECT_ROLE_ORDER.MEMBER) {
      return fail("You don't have permission to do that.");
    }

    const existing = await prisma.taskWatcher.findUnique({
      where: { taskId_userId: { taskId, userId } },
      select: { id: true },
    });
    if (existing) {
      const target = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      await prisma.taskWatcher.delete({ where: { id: existing.id } });
      await prisma.activityLog.create({
        data: {
          taskId,
          actorId: user.id,
          action: "watcher_removed",
          field: "watcher",
          oldValue: target?.name ?? null,
        },
      });
    }
    revalidatePath(`/projects/${task.projectId}`, "layout");
    return { ok: true, data: { removed: Boolean(existing) } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}
```

> Note: `requireUser` may now be unused in this file's import — if ESLint flags it, drop it from the import list.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/notifications/actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/notifications/actions.ts src/features/notifications/actions.test.ts
git commit -m "feat(watchers): add/remove other users as task watchers"
```

---

### Task A5: Notification + activity copy for watcher events

**Files:**
- Modify: `src/features/notifications/components/notificationFormat.ts`
- Modify: `src/features/tasks/components/ActivityList.tsx`

- [ ] **Step 1: Add the notification sentence case**

In `notificationFormat.ts`, add a case inside `notificationSentence`'s switch (before `default`):

```ts
    case "TASK_WATCHER_ADDED":
      return `${who} added you as a watcher`
```

- [ ] **Step 2: Add the activity `describe` + icon cases**

In `ActivityList.tsx`, add `Eye` to the lucide import:

```ts
import {
  ArrowRightLeft,
  CalendarDays,
  Eye,
  FileX,
  MessageSquareOff,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  Tag,
  UserRound,
  type LucideIcon,
} from "lucide-react"
```

In `iconFor`, add before the `switch (entry.action)`:

```ts
  if (entry.field === "watcher") return Eye
```

In `describe`, add after the `if (field === "assignee")` block:

```ts
  if (field === "watcher") {
    return action === "watcher_removed" ? (
      <>removed {mono(oldValue ?? "someone")} as watcher</>
    ) : (
      <>added {mono(newValue ?? "someone")} as watcher</>
    )
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "notificationFormat|ActivityList" || echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add src/features/notifications/components/notificationFormat.ts src/features/tasks/components/ActivityList.tsx
git commit -m "feat(watchers): notification + activity copy for watcher events"
```

---

### Task A6: `WatchersSection` client component

**Files:**
- Create: `src/features/notifications/components/WatchersSection.tsx`

**Interfaces:**
- Consumes: `addTaskWatcher`, `removeTaskWatcher` (A4), `TaskWatcherItem` (A3), `AssigneeAvatar` (`@/features/tasks/components/AssigneeAvatar`), ui `Button`, `Popover`.
- Produces: `WatchersSection` component with props
  `{ taskId: string; watchers: TaskWatcherItem[]; members: Member[]; canManage: boolean; currentUserId: string }`
  where `Member = Pick<User,"id"|"name"|"username"|"avatarKey">`.
- Rendered as the child of the drawer's "Watchers" `DrawerSection` (that section supplies the title), so this component renders only the list + add control.

- [ ] **Step 1: Write the component**

```tsx
// src/features/notifications/components/WatchersSection.tsx
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { User } from "@/generated/prisma/client"
import { AssigneeAvatar } from "@/features/tasks/components/AssigneeAvatar"

import { addTaskWatcher, removeTaskWatcher } from "../actions"
import type { TaskWatcherItem } from "../queries"

type Member = Pick<User, "id" | "name" | "username" | "avatarKey">

export interface WatchersSectionProps {
  taskId: string
  watchers: TaskWatcherItem[]
  members: Member[]
  canManage: boolean
  currentUserId: string
}

export function WatchersSection({
  taskId,
  watchers,
  members,
  canManage,
  currentUserId,
}: WatchersSectionProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [open, setOpen] = React.useState(false)

  const watcherIds = new Set(watchers.map((w) => w.id))
  const addable = members.filter((m) => !watcherIds.has(m.id))

  function onAdd(userId: string) {
    setOpen(false)
    startTransition(async () => {
      const res = await addTaskWatcher({ taskId, userId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Watcher added")
      router.refresh()
    })
  }

  function onRemove(userId: string) {
    startTransition(async () => {
      const res = await removeTaskWatcher({ taskId, userId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {watchers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No watchers yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {watchers.map((w) => {
            const removable = canManage || w.id === currentUserId
            return (
              <li key={w.id} className="flex items-center gap-2">
                <AssigneeAvatar user={w} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {w.name}{" "}
                  <span className="text-muted-foreground">@{w.username}</span>
                </span>
                {removable ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => onRemove(w.id)}
                    disabled={isPending}
                    aria-label={`Remove ${w.name} as watcher`}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {canManage ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                disabled={isPending || addable.length === 0}
                aria-label="Add watcher"
              />
            }
          >
            <Plus className="size-3" aria-hidden />
            Add watcher
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            {addable.length > 0 ? (
              <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                {addable.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => onAdd(m.id)}
                      disabled={isPending}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-foreground hover:bg-surface-raised"
                    >
                      <AssigneeAvatar user={m} />
                      <span className="min-w-0 flex-1 truncate">
                        {m.name}{" "}
                        <span className="text-muted-foreground">
                          @{m.username}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1.5 py-1 text-xs text-muted-foreground">
                Everyone on this project is already watching.
              </p>
            )}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep WatchersSection || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/features/notifications/components/WatchersSection.tsx
git commit -m "feat(watchers): WatchersSection client component"
```

---

### Task A7: Slot Watchers into the task drawer + thread data through

**Files:**
- Modify: `src/features/tasks/components/TaskDrawer.tsx` (props ~line 59-88; slot area ~line 551-568)
- Modify: `src/features/tasks/components/TaskDetailPanel.tsx` (props + render)
- Modify: `src/app/(dashboard)/projects/[projectId]/page.tsx`

**Interfaces:**
- Consumes: `WatchersSection` (A6), `getTaskWatchers` (A3).
- Produces: a `watchers?: React.ReactNode` slot on `TaskDrawerProps`; a `watchers: TaskWatcherItem[]` prop on `TaskDetailPanel`.

- [ ] **Step 1: Add the drawer slot prop**

In `TaskDrawer.tsx` `TaskDrawerProps`, add after `activity?: React.ReactNode`:

```ts
  /** Watchers panel (built by the caller). */
  watchers?: React.ReactNode
```

Add `watchers` to the destructured props of the `TaskDrawer` component (wherever `activity` is destructured).

- [ ] **Step 2: Render the Watchers section in the slot area**

In `TaskDrawer.tsx`, inside the `{/* Slot sections */}` container (~line 552), add a Watchers section immediately after the Description one:

```tsx
                <DrawerSection title="Watchers" emptyText="No watchers yet.">
                  {watchers}
                </DrawerSection>
```

Place it between the `Description` and `Attachments` `DrawerSection`s.

- [ ] **Step 3: Thread props through `TaskDetailPanel`**

In `TaskDetailPanel.tsx`:

- Add the import:

```tsx
import { WatchersSection } from "@/features/notifications/components/WatchersSection"
import type { TaskWatcherItem } from "@/features/notifications/queries"
```

- Add to its props interface (near `isWatching`):

```tsx
  /** Users currently watching this task (drives the Watchers panel). */
  watchers: TaskWatcherItem[]
```

- Destructure `watchers` alongside the other props.
- Pass a `watchers` slot to `<TaskDrawer ... />` (next to `headerAction=`):

```tsx
      watchers={
        <WatchersSection
          taskId={task.id}
          watchers={watchers}
          members={members}
          canManage={canEdit}
          currentUserId={currentUserId}
        />
      }
```

- [ ] **Step 4: Fetch + pass watchers from the project page**

In `src/app/(dashboard)/projects/[projectId]/page.tsx`:

- Extend the `getTaskWatchers` import (same module as `isWatchingTask`):

```ts
import { isWatchingTask, getTaskWatchers } from "@/features/notifications/queries"
```

(match the existing import path/style for `isWatchingTask`; add `getTaskWatchers` to it or a sibling import.)

- Add `watchers` to the `drawerData` type:

```ts
  let drawerData: {
    task: TaskDetail
    comments: CommentWithAuthor[]
    attachments: AttachmentWithUploader[]
    activity: ActivityEntry[]
    isWatching: boolean
    watchers: TaskWatcherItem[]
  } | null = null
```

(import the `TaskWatcherItem` type at the top: `import type { TaskWatcherItem } from "@/features/notifications/queries"`.)

- Add `getTaskWatchers(taskId)` to the drawer `Promise.all` and store it:

```ts
        const [comments, attachments, activity, isWatching, watchers] =
          await Promise.all([
            getComments(taskId),
            getAttachments(taskId),
            getTaskActivity(taskId),
            isWatchingTask(taskId),
            getTaskWatchers(taskId),
          ])
        drawerData = { task, comments, attachments, activity, isWatching, watchers }
```

- Pass it to the panel (next to `isWatching={drawerData.isWatching}`):

```tsx
      watchers={drawerData.watchers}
```

- [ ] **Step 5: Build to verify the wiring**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds; no type errors about `watchers`.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/components/TaskDrawer.tsx src/features/tasks/components/TaskDetailPanel.tsx "src/app/(dashboard)/projects/[projectId]/page.tsx"
git commit -m "feat(watchers): show + manage watchers in the task drawer"
```

---

# PART B — Audit log Target shows names, not cuids

Extract a pure `buildTargetLabel` helper (unit-tested with no mocks), then batch-resolve target rows inside `getAuditLog` and render the label in `AuditTable`.

### Task B1: `buildTargetLabel` pure helper (TDD)

**Files:**
- Create: `src/features/admin/audit-target.ts`
- Create: `src/features/admin/audit-target.test.ts`

**Interfaces:**
- Produces:
  - `AuditTargetLookups` — Maps keyed by id per type.
  - `buildTargetLabel(targetType: string, targetId: string, lookups: AuditTargetLookups): string` — human label, falling back to `targetId` when unresolved.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/admin/audit-target.test.ts
import { describe, expect, it } from "vitest";
import { buildTargetLabel, type AuditTargetLookups } from "./audit-target";

const lookups: AuditTargetLookups = {
  users: new Map([["u1", { name: "Jane Doe", username: "jane" }]]),
  projects: new Map([["p1", { key: "OPS", name: "Operations" }]]),
  tasks: new Map([["t1", { key: "OPS-42" }]]),
  invites: new Map([["i1", { email: "new@acme.io" }]]),
  memberships: new Map([
    ["m1", { userName: "Jane Doe", username: "jane", projectKey: "OPS" }],
  ]),
};

describe("buildTargetLabel", () => {
  it("resolves a User target to name + @username", () => {
    expect(buildTargetLabel("User", "u1", lookups)).toBe("Jane Doe @jane");
  });
  it("resolves a Project target to key — name", () => {
    expect(buildTargetLabel("Project", "p1", lookups)).toBe("OPS — Operations");
  });
  it("resolves a Task target to its key", () => {
    expect(buildTargetLabel("Task", "t1", lookups)).toBe("OPS-42");
  });
  it("resolves an Invite target to its email", () => {
    expect(buildTargetLabel("Invite", "i1", lookups)).toBe("new@acme.io");
  });
  it("resolves a ProjectMembership to user @username · project", () => {
    expect(buildTargetLabel("ProjectMembership", "m1", lookups)).toBe(
      "Jane Doe @jane · OPS",
    );
  });
  it("falls back to the raw id for a deleted/unknown target", () => {
    expect(buildTargetLabel("User", "gone", lookups)).toBe("gone");
    expect(buildTargetLabel("Comment", "c1", lookups)).toBe("c1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/admin/audit-target.test.ts`
Expected: FAIL — module `./audit-target` not found.

- [ ] **Step 3: Write the helper**

```ts
// src/features/admin/audit-target.ts
// Pure resolution of an AuditLog (targetType, targetId) to a human label.
// The Maps are populated by getAuditLog via batched queries; this file has no
// DB access so it stays trivially unit-testable.

export interface AuditTargetLookups {
  users: Map<string, { name: string; username: string }>;
  projects: Map<string, { key: string; name: string }>;
  tasks: Map<string, { key: string }>;
  invites: Map<string, { email: string }>;
  memberships: Map<
    string,
    { userName: string; username: string; projectKey: string }
  >;
}

/** Human label for an audit target, or the raw id when it can't be resolved. */
export function buildTargetLabel(
  targetType: string,
  targetId: string,
  l: AuditTargetLookups,
): string {
  switch (targetType) {
    case "User": {
      const u = l.users.get(targetId);
      return u ? `${u.name} @${u.username}` : targetId;
    }
    case "Project": {
      const p = l.projects.get(targetId);
      return p ? `${p.key} — ${p.name}` : targetId;
    }
    case "Task": {
      const t = l.tasks.get(targetId);
      return t ? t.key : targetId;
    }
    case "Invite": {
      const i = l.invites.get(targetId);
      return i ? i.email : targetId;
    }
    case "ProjectMembership": {
      const m = l.memberships.get(targetId);
      return m ? `${m.userName} @${m.username} · ${m.projectKey}` : targetId;
    }
    default:
      return targetId;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/admin/audit-target.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/audit-target.ts src/features/admin/audit-target.test.ts
git commit -m "feat(audit): pure buildTargetLabel helper"
```

---

### Task B2: Batch-resolve targets in `getAuditLog`

**Files:**
- Modify: `src/features/admin/queries.ts` (`AdminAuditRow` ~line 337; `getAuditLog` ~line 353)

**Interfaces:**
- Consumes: `buildTargetLabel`, `AuditTargetLookups` (B1).
- Produces: `AdminAuditRow` gains `targetLabel: string` (keeps `targetId`).

- [ ] **Step 1: Import the helper**

Near the top of `queries.ts`, add:

```ts
import { buildTargetLabel, type AuditTargetLookups } from "./audit-target";
```

- [ ] **Step 2: Add `targetLabel` to the row type**

In `AdminAuditRow`, add:

```ts
  targetLabel: string;
```

- [ ] **Step 3: Batch-resolve after fetching the page, before mapping**

In `getAuditLog`, replace the `return { items: page.map(...) }` block with:

```ts
  // Group target ids by type, then one query per present type (no N+1).
  const idsByType = new Map<string, Set<string>>();
  for (const r of page) {
    const set = idsByType.get(r.targetType) ?? new Set<string>();
    set.add(r.targetId);
    idsByType.set(r.targetType, set);
  }
  const idsFor = (t: string) => [...(idsByType.get(t) ?? [])];

  const [users, projects, tasks, invites, memberships] = await Promise.all([
    idsFor("User").length
      ? prisma.user.findMany({
          where: { id: { in: idsFor("User") } },
          select: { id: true, name: true, username: true },
        })
      : [],
    idsFor("Project").length
      ? prisma.project.findMany({
          where: { id: { in: idsFor("Project") } },
          select: { id: true, key: true, name: true },
        })
      : [],
    idsFor("Task").length
      ? prisma.task.findMany({
          where: { id: { in: idsFor("Task") } },
          select: { id: true, key: true },
        })
      : [],
    idsFor("Invite").length
      ? prisma.invite.findMany({
          where: { id: { in: idsFor("Invite") } },
          select: { id: true, email: true },
        })
      : [],
    idsFor("ProjectMembership").length
      ? prisma.projectMembership.findMany({
          where: { id: { in: idsFor("ProjectMembership") } },
          select: {
            id: true,
            user: { select: { name: true, username: true } },
            project: { select: { key: true } },
          },
        })
      : [],
  ]);

  const lookups: AuditTargetLookups = {
    users: new Map(users.map((u) => [u.id, { name: u.name, username: u.username }])),
    projects: new Map(projects.map((p) => [p.id, { key: p.key, name: p.name }])),
    tasks: new Map(tasks.map((t) => [t.id, { key: t.key }])),
    invites: new Map(invites.map((i) => [i.id, { email: i.email }])),
    memberships: new Map(
      memberships.map((m) => [
        m.id,
        {
          userName: m.user.name,
          username: m.user.username,
          projectKey: m.project.key,
        },
      ]),
    ),
  };

  return {
    items: page.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      targetLabel: buildTargetLabel(r.targetType, r.targetId, lookups),
      actorName: r.actor.name,
      actorUsername: r.actor.username,
      metadata: r.metadata,
      createdAtLabel: dateTimeFmt.format(r.createdAt),
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "admin/queries" || echo OK`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/queries.ts
git commit -m "feat(audit): resolve target ids to human labels in getAuditLog"
```

---

### Task B3: Render the label in `AuditTable`

**Files:**
- Modify: `src/features/admin/components/AuditTable.tsx` (Target cell ~line 92-95)

- [ ] **Step 1: Render `targetLabel`, keep the raw id as a tooltip**

Replace the Target `<TableCell>` body (lines ~92-95) with:

```tsx
                  <TableCell title={r.targetId}>
                    <span className="text-muted-foreground">{r.targetType}</span>{" "}
                    <span className="text-foreground">{r.targetLabel}</span>
                  </TableCell>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep AuditTable || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/features/admin/components/AuditTable.tsx
git commit -m "feat(audit): show target label with raw id on hover"
```

---

# PART C — Assignee filter: unassigned + assigned-to-me + @username + multi-select

Change the shared filter from a single `assigneeId` to `assigneeIds[] + includeUnassigned`, thread it through the page's param parsing (resolving `me`→session id, `none`→unassigned), and replace the single assignee `Select` with a multi-select checkbox popover.

### Task C1: Multi-assignee `taskFilterWhere` (TDD)

**Files:**
- Modify: `src/features/tasks/queries.ts` (`TaskFilterSet` ~line 49; `taskFilterWhere` ~line 60; `BacklogFilters` ~line 133)
- Create: `src/features/tasks/queries.test.ts`

**Interfaces:**
- Produces: exported `taskFilterWhere(projectId, filters)`; `TaskFilterSet` now has `assigneeIds?: string[]` + `includeUnassigned?: boolean` (replacing `assigneeId?: string`).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/tasks/queries.test.ts
import { describe, expect, it } from "vitest";
import { taskFilterWhere } from "./queries";

describe("taskFilterWhere — assignee", () => {
  it("filters by a set of assignee ids (IN)", () => {
    const w = taskFilterWhere("p1", { assigneeIds: ["u1", "u2"] });
    expect(w.assigneeId).toEqual({ in: ["u1", "u2"] });
    expect(w.AND).toBeUndefined();
  });

  it("filters unassigned as assigneeId null", () => {
    const w = taskFilterWhere("p1", { includeUnassigned: true });
    expect(w.assigneeId).toBeNull();
  });

  it("ORs ids + unassigned together under AND", () => {
    const w = taskFilterWhere("p1", {
      assigneeIds: ["u1"],
      includeUnassigned: true,
    });
    expect(w.assigneeId).toBeUndefined();
    expect(w.AND).toEqual([
      { OR: [{ assigneeId: null }, { assigneeId: { in: ["u1"] } }] },
    ]);
  });

  it("AND-composes the assignee OR-group with the search OR-group", () => {
    const w = taskFilterWhere("p1", {
      assigneeIds: ["u1"],
      includeUnassigned: true,
      q: "login",
    });
    // Two independent OR groups both apply — neither is dropped.
    expect(w.AND).toHaveLength(2);
  });

  it("no assignee filter → no assignee constraint", () => {
    const w = taskFilterWhere("p1", {});
    expect(w.assigneeId).toBeUndefined();
    expect(w.AND).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/queries.test.ts`
Expected: FAIL — `taskFilterWhere` is not exported (and old fields differ).

- [ ] **Step 3: Update `TaskFilterSet` + `BacklogFilters`**

In `queries.ts`, replace `assigneeId?: string;` in `TaskFilterSet` (line ~54) with:

```ts
  /** Filter to these assignees (OR). Empty/undefined = no assignee filter. */
  assigneeIds?: string[];
  /** Also include tasks with no assignee (ORed with assigneeIds). */
  includeUnassigned?: boolean;
```

Do the same replacement of `assigneeId?: string;` in `BacklogFilters` (line ~137).

- [ ] **Step 4: Export + rewrite `taskFilterWhere`'s assignee/search handling**

Change the signature line to export it and rewrite the assignee + search clauses:

```ts
/** Build the shared `where` for top-level project tasks + the common filters. */
export function taskFilterWhere(
  projectId: string,
  filters: TaskFilterSet,
): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = { projectId, parentId: null };
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.priority) where.priority = filters.priority;
  if (filters.labelId) where.labels = { some: { id: filters.labelId } };

  const and: Prisma.TaskWhereInput[] = [];

  // Assignee: ids (IN), unassigned (null), or both (OR under AND so it never
  // collides with the search OR-group below).
  const ids = filters.assigneeIds ?? [];
  if (ids.length > 0 && filters.includeUnassigned) {
    and.push({ OR: [{ assigneeId: null }, { assigneeId: { in: ids } }] });
  } else if (ids.length > 0) {
    where.assigneeId = { in: ids };
  } else if (filters.includeUnassigned) {
    where.assigneeId = null;
  }

  // Free-text: title contains OR exact key match.
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { key: { equals: q, mode: "insensitive" } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;
  return where;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/tasks/queries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/queries.ts src/features/tasks/queries.test.ts
git commit -m "feat(filter): multi-assignee + unassigned in taskFilterWhere"
```

---

### Task C2: Parse the repeatable assignee param in the project page

**Files:**
- Modify: `src/app/(dashboard)/projects/[projectId]/page.tsx` (currentParams loop ~line 135-139; `filterSet` ~line 143-150)

**Interfaces:**
- Consumes: `session.user.id` (already available), `sp.assigneeId` (`string | string[] | undefined`).
- Produces: `filterSet.assigneeIds` + `filterSet.includeUnassigned` (replacing `assigneeId`).

- [ ] **Step 1: Make `currentParams` array-aware (so multi-value survives paging/tab links)**

Replace the `currentParams` build loop (~line 135-139) with:

```ts
  // Carries every current search param forward into pagination/tab links —
  // array-aware so repeated params (e.g. multiple assigneeId) aren't dropped.
  const currentParams = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) for (const v of value) currentParams.append(key, v)
    else if (value) currentParams.set(key, value)
  }
```

- [ ] **Step 2: Parse assignee values and build the new filter fields**

Replace `assigneeId: asString(sp.assigneeId),` inside `filterSet` (line ~147) — but first, just above the `filterSet` declaration, add the parsing:

```ts
  // Assignee filter is a repeatable param; each value is a user id, "me"
  // (resolved to the signed-in user so saved views stay portable), or "none"
  // (unassigned).
  const rawAssignee = sp.assigneeId
  const assigneeValues = Array.isArray(rawAssignee)
    ? rawAssignee
    : rawAssignee
      ? [rawAssignee]
      : []
  const includeUnassigned = assigneeValues.includes("none")
  const assigneeIds = [
    ...new Set(
      assigneeValues
        .filter((v) => v !== "none")
        .map((v) => (v === "me" ? session.user.id : v)),
    ),
  ]
```

Then in `filterSet`, replace the `assigneeId` line with:

```ts
    assigneeIds,
    includeUnassigned,
```

- [ ] **Step 3: Build to verify types line up (board + backlog both consume `filterSet`)**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds; no error about `assigneeId` on the filter set.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/projects/[projectId]/page.tsx"
git commit -m "feat(filter): parse repeatable assignee param (ids, me, none)"
```

---

### Task C3: Multi-select assignee control in `TaskFilters`

**Files:**
- Modify: `src/features/tasks/components/TaskFilters.tsx` (props ~line 34-39; assignee Select ~line 381-399; helpers)
- Modify: `src/app/(dashboard)/projects/[projectId]/page.tsx` (pass `currentUserId` to both `<TaskFilters>` usages)

**Interfaces:**
- Consumes: `searchParams.getAll("assigneeId")`, `addTaskWatcher`-style toast pattern (none needed here — URL-only).
- Produces: `TaskFilters` gains a `currentUserId: string` prop; the assignee `Select` becomes a checkbox `Popover`.

- [ ] **Step 1: Add `currentUserId` to props + a multi-value URL updater + `Checkbox` import**

In `TaskFilters.tsx`:

- Add to the `Checkbox` import (create the import if absent):

```tsx
import { Checkbox } from "@/components/ui/checkbox"
```

- Add `currentUserId: string` to `TaskFiltersProps`.
- Destructure `currentUserId` in the `TaskFilters` function params.
- Add this helper next to `updateParam`:

```tsx
  function toggleAssignee(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    const current = params.getAll("assigneeId")
    params.delete("assigneeId")
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    for (const v of next) params.append("assigneeId", v)
    params.delete("cursor")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }
```

- [ ] **Step 2: Derive current selection + trigger label**

Just after the other `searchParams.get(...)` reads (~line 252), add:

```tsx
  const selectedAssignees = searchParams.getAll("assigneeId")
  const assigneeCount = selectedAssignees.length
  const assigneeTriggerLabel =
    assigneeCount === 0
      ? "All assignees"
      : assigneeCount === 1
        ? selectedAssignees[0] === "me"
          ? "Assigned to me"
          : selectedAssignees[0] === "none"
            ? "Unassigned"
            : (members.find((m) => m.id === selectedAssignees[0])?.name ??
              "1 assignee")
        : `${assigneeCount} assignees`
```

- [ ] **Step 3: Replace the single assignee `Select` with a checkbox popover**

Replace the whole `{members.length > 0 ? ( <Select ... assignee ... /> ) : null}` block (~line 381-399) with:

```tsx
      {members.length > 0 ? (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between sm:w-40"
                aria-label="Filter by assignee"
              />
            }
          >
            <span className="truncate">{assigneeTriggerLabel}</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-foreground hover:bg-surface-raised">
                <Checkbox
                  checked={selectedAssignees.includes("me")}
                  onCheckedChange={() => toggleAssignee("me")}
                />
                <span>Assigned to me</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-foreground hover:bg-surface-raised">
                <Checkbox
                  checked={selectedAssignees.includes("none")}
                  onCheckedChange={() => toggleAssignee("none")}
                />
                <span>Unassigned</span>
              </label>
              <Separator className="my-1" />
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-foreground hover:bg-surface-raised"
                >
                  <Checkbox
                    checked={selectedAssignees.includes(m.id)}
                    onCheckedChange={() => toggleAssignee(m.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {m.name}{" "}
                    <span className="text-muted-foreground">@{m.username}</span>
                  </span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
```

- [ ] **Step 4: Fix `hasActiveFilters` + remove the now-unused single-assignee derivations**

- Remove the `const assigneeId = searchParams.get("assigneeId") ?? ALL` line and the `assigneeItems` useMemo (no longer used).
- In `hasActiveFilters`, replace the `assigneeId !== ALL ||` term with `assigneeCount > 0 ||`.
- `FILTER_KEYS` already includes `"assigneeId"`, and `clearAll` uses `params.delete("assigneeId")` which clears all repeated values — no change needed there.

- [ ] **Step 5: Pass `currentUserId` from the page**

In `page.tsx`, both `<TaskFilters ... />` usages (board ~line 160 and backlog ~line 190) get:

```tsx
          currentUserId={session.user.id}
```

- [ ] **Step 6: Build + run the filter tests**

Run: `npm run build 2>&1 | tail -20 && npx vitest run src/features/tasks/queries.test.ts`
Expected: build succeeds; filter tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/components/TaskFilters.tsx "src/app/(dashboard)/projects/[projectId]/page.tsx"
git commit -m "feat(filter): multi-select assignee with me + unassigned + @username"
```

---

# Final verification

- [ ] **Full test suite**

Run: `npm run test`
Expected: all pass (includes the three new test files).

- [ ] **Lint + build**

Run: `npm run lint && npm run build`
Expected: clean lint; successful build.

- [ ] **Manual smoke (dev)**

Run: `npm run dev`, then:
1. Open a task drawer as a MEMBER → "Watchers" section shows; add another member → they appear with `@username`; remove them.
2. As a VIEWER → no "Add watcher"; the only removable row is yourself (via the existing header Watch toggle for self).
3. `/admin/audit` → Target column shows names (e.g. "Jane Doe @jane", "OPS-42"), raw id on hover.
4. Backlog filter → open Assignee → tick "Assigned to me", "Unassigned", and two people; verify results and that "Load more" keeps the filter.

---

## Notes for the implementer

- Base UI `Select`/`Popover`/`Checkbox` are already used elsewhere in this file set — copy their exact import paths from `TaskFilters.tsx` / `TaskDrawer.tsx` if unsure.
- `AssigneeAvatar` already resolves an avatar from a `{ id, name, username, avatarKey }` user — reuse it; don't build a new avatar.
- Store **names** (not ids) in watcher ActivityLog `oldValue`/`newValue` — this is the "user id must be visible, not random characters" requirement applied to the activity feed.
- Keep `toggleWatchTask` (self-watch) exactly as-is; the new actions are additive.
