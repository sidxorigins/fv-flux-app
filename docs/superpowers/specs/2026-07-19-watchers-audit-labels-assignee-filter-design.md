# Design — Task Watchers, Audit Target Labels, Assignee Filter

Date: 2026-07-19
Branch: `feat/watchers-audit-labels-assignee-filter`

Three bounded, independent parts. They share a session but ship as separate
commits/plans. Only Part A carries a migration.

---

## Part A — Task Watchers (add others)

### Goal
Any project **MEMBER** or **MANAGER** can add other project members as watchers
of a task. Multiple watchers per task. VIEWERs keep the existing self-watch
toggle. Watchers already receive a task's follow-up notices (comments, status
changes) via `getTaskAudience` — this part adds the ability to manage *other*
people's watch state, plus the UI to see and edit the watcher list.

### Current state (verified)
- `TaskWatcher` model already exists (`@@unique([taskId, userId])`). Multiple
  watchers already supported → **no schema change for the core feature.**
- Watching is self-only today: `toggleWatchTask(taskId)` toggles the signed-in
  user; assignees and commenters auto-subscribe via `ensureWatching`.
- `getTaskAudience(taskId)` already unions watchers + assignee + reporter and is
  used by the notify fan-out.
- `TaskDetailPanel` already receives `members: Member[]` and `canEdit` (MEMBER+),
  and `TaskDrawer` renders sidebar `DrawerSection` blocks (Assignee/Due/Labels).
- Project page (`projects/[projectId]/page.tsx`) already loads `members` and
  `isWatchingTask(taskId)` in a `Promise.all`.

### Data
- **Migration (only one in the whole spec):** add enum value
  `NotificationType.TASK_WATCHER_ADDED`. Postgres `ALTER TYPE ... ADD VALUE`
  via `prisma migrate dev`.

### Server (`features/notifications/`)
- `schemas.ts` (new): `watcherActionSchema = z.object({ taskId, userId })`.
- `actions.ts`:
  - `addTaskWatcher(taskId, userId)`:
    1. Load task → `projectId`; 404 if missing.
    2. `requireProjectRole(projectId, "MEMBER")` (gate: MEMBER+).
    3. Validate the target has a `ProjectMembership` on that project (can't
       watch a project you can't see). Reject otherwise.
    4. `prisma.taskWatcher.upsert` (idempotent).
    5. `notify({ recipientIds:[userId], actorId, type:"TASK_WATCHER_ADDED", taskId })`
       (best-effort; skips self and non-ACTIVE users already).
    6. ActivityLog: `action:"watcher_added"`, `field:"watcher"`,
       `newValue: <watcher display name snapshot>` — store the **name**, never
       the id, so the activity reads "added Jane Doe as watcher".
    7. `revalidatePath(\`/projects/${projectId}\`, "layout")`.
  - `removeTaskWatcher(taskId, userId)`:
    - Allowed if caller is MEMBER+ **or** `userId === caller.id` (self-removal).
    - Delete the `TaskWatcher` row (no-op if absent).
    - ActivityLog `action:"watcher_removed"`, `field:"watcher"`,
      `oldValue: <name snapshot>`.
    - Revalidate.
  - `toggleWatchTask` (self) — unchanged.
- `queries.ts`: `getTaskWatchers(taskId)` → `{id,name,username,avatarKey}[]`,
  `requireProjectRole(projectId, "VIEWER")`; `[]` for a missing task (mirrors
  `getTaskActivity`).

### UI
- `features/notifications/components/WatchersSection.tsx` (client):
  - Renders the watcher list: avatar + `name` + muted `@username`.
  - MEMBER+ (`canManage`): an "Add watcher" popover — a people-picker sourced
    from `members`, filtered to exclude current watchers; selecting one calls
    `addTaskWatcher` then `router.refresh()`.
  - Per-row remove (X) shown when `canManage` OR the row is the current user.
    Calls `removeTaskWatcher`.
  - Toasts on success/failure (match `WatchToggle` pattern).
- Wire-up:
  - `TaskDrawer`: add a `watchers` sidebar `DrawerSection` + new props
    (`watchers`, `canManageWatchers`, `currentUserId`, `members` already present).
  - `TaskDetailPanel`: thread `watchers` + `canManageWatchers = canEdit` through.
  - `projects/[projectId]/page.tsx`: add `getTaskWatchers(taskId)` to the drawer
    `Promise.all`; pass down.
- `features/notifications/components/notificationFormat.ts`: add a
  `TASK_WATCHER_ADDED` case ("added you as a watcher on <task>").
- `features/tasks/components/ActivityList.tsx`: add `watcher_added` /
  `watcher_removed` cases to `describe()` + an icon (e.g. `Eye`), rendering the
  stored name snapshot.

### Tests (`features/notifications`)
- `addTaskWatcher`: MEMBER+ succeeds; VIEWER rejected (FORBIDDEN); non-member
  target rejected; idempotent on repeat.
- `removeTaskWatcher`: MEMBER+ removes anyone; VIEWER removes self; VIEWER
  removing another → FORBIDDEN.

---

## Part B — Audit log Target shows names, not cuids

### Goal
`/admin/audit`'s **Target** column renders the raw `targetId` cuid (e.g. a User
id for role-change/suspend/invite/membership events). Resolve it to a human
label for every resolvable `targetType`. Keep the raw id available so the audit
trail stays precise.

### Current state (verified)
- `AuditTable.tsx` renders `{r.targetType} {r.targetId}` (raw cuid).
- Actor column already resolves to `name` + `@username`.
- `targetType` values written across the app: `User`, `Project`,
  `ProjectMembership`, `Invite`, `Task`, `Comment`, `Attachment`.

### Server (`features/admin/queries.ts`)
- In `getAuditLog`, after fetching the page rows, **batch-resolve** targets by
  type (group ids by `targetType`, one query per present type — no N+1):
  - `User` → `"<name> @<username>"`
  - `Project` → `"<key> — <name>"`
  - `Task` → `"<key>"`
  - `Invite` → `"<email>"`
  - `ProjectMembership` → `"<user name> @<username> · <project key>"`
    (join through the membership row).
  - `Comment` / `Attachment` / unknown / deleted target → fall back to the raw
    `targetId`.
- `AdminAuditRow` gains `targetLabel: string` (resolved) while keeping
  `targetId` for the tooltip.

### UI (`AuditTable.tsx`)
- Target cell: show `targetType` + **`targetLabel`**; put the raw `targetId` in
  the cell's `title` (hover tooltip) so precise lookups are still possible.

### Tests (`features/admin`)
- `getAuditLog` label resolution: a `User` target resolves to `name @username`;
  a `Task` target resolves to its key; a target whose row was deleted falls back
  to the raw id.

---

## Part C — Assignee filter: unassigned + assigned-to-me + @username + multi-select

### Goal
Improve the existing backlog/board Assignee filter with: an **Unassigned**
option, an **Assigned to me** shortcut, **@username** shown in options, and
**multi-select** (OR across chosen assignees).

### Current state (verified)
- Filter bar `TaskFilters.tsx` renders a single-value assignee `Select` showing
  `m.name`.
- `taskFilterWhere` (shared by board + backlog) sets `where.assigneeId =
  filters.assigneeId` (single string).
- Project `page.tsx` parses `assigneeId: asString(sp.assigneeId)` (single value).

### Param model
- `assigneeId` becomes **repeatable**. Each value is one of:
  - a user id (cuid),
  - `me` — resolved **server-side** to the signed-in user's id (keeps saved
    views portable across viewers),
  - `none` — unassigned (assigneeId is null).

### Server
- `tasks/queries.ts` `TaskFilterSet`: replace `assigneeId?: string` with
  `assigneeIds?: string[]` + `includeUnassigned?: boolean` (parsed from the raw
  values; `me` already resolved to an id by the page).
- `taskFilterWhere`: build the assignee clause:
  - ids only → `assigneeId: { in: ids }`
  - unassigned only → `assigneeId: null`
  - both → `OR: [{ assigneeId: null }, { assigneeId: { in: ids } }]`
  - neither → no assignee constraint.
  - Merge safely with the existing search `where.OR` (search uses `OR`; combine
    via `AND` so the two OR-groups don't collide).
- `page.tsx`: parse all `assigneeId` values (array-aware via `sp.assigneeId`
  which is already `string | string[]`); resolve `me` → session user id; split
  `none` into the unassigned flag; pass `assigneeIds` + `includeUnassigned`.

### UI (`TaskFilters.tsx`)
- Replace the single assignee `Select` with a checkbox **Popover** (multi-select):
  - Pinned top rows: **Assigned to me**, **Unassigned**.
  - Then each member: avatar + `name` + muted `@username`, checkbox.
  - Trigger label: "All assignees" / a single name / "N assignees".
  - Writes repeated `assigneeId=<value>` params via `URLSearchParams.append`;
    clearing removes them; changing any filter still resets `cursor`.
- `FILTER_KEYS` / `clearAll` / `hasActiveFilters` updated for the multi-value
  param.
- Pass `currentUserId` into `TaskFilters` (for the "me" pin) — already available
  on the page.

### Tests (`features/tasks`)
- `taskFilterWhere`: ids-only → `in`; unassigned-only → `null`; both → `OR`;
  combined with a search `q` → the assignee OR-group and the search OR-group are
  AND-ed (a search + assignee filter both apply, neither is dropped).

---

## Out of scope
- Watcher email (in-app notification only for `TASK_WATCHER_ADDED`).
- Watching users who are not project members.
- Multi-select for status/type/priority/label filters (assignee only).
- Any change to `toggleWatchTask` self-watch behaviour.

## Sequencing
A → B → C, independent commits. Migration lands with A only.
