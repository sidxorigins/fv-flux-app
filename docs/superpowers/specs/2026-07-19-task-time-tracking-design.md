# Design — Task Time Tracking (live timer)

Date: 2026-07-19
Branch: `feat/task-time-tracking`

Adds per-task time tracking via a live start/stop timer, roll-up totals, and four
views. Explicitly requested (overrides CLAUDE.md's "time tracking out of scope for
v1"). Scope = **time spent only** (no estimates/remaining).

---

## Locked decisions
- **Live timer** entry (not manual work-logs). Start/stop; elapsed accrues into a
  completed entry on stop.
- **One active timer per user.** Starting a timer **auto-stops** any running timer
  the user has (writes its minutes), then starts the new one; the UI toasts
  "Stopped timer on OPS-12." DB-enforced by a partial unique index.
- **Spent only** — no estimate/remaining fields.
- **Permissions:** MEMBER+ logs/edits/deletes their **own** entries on tasks they can
  access; project **MANAGER**/Admin can edit/delete **any** entry; VIEWER read-only.
- **Breakdown visibility:** everyone VIEWER+ sees the task **total** + **their own**
  logged time; the **per-user breakdown** (who logged what) is **MANAGER/Admin-only**.
  Same rule on the project report. The admin global report is Admin-only.
- Store integer **minutes**; display "2h 30m" / "45m". Round elapsed to nearest
  minute on stop (min 1m).
- **No ActivityLog entries** for time events (timers stop too often — would spam the
  feed). No notifications.

## Non-goals (v1)
- Manual back-dated work-logs, estimates/remaining, billing/rates, timer reminders,
  auto-cap of runaway timers (mitigated by editable/deletable entries), CSV export.

---

## Data model

New Prisma model:

```
TimeEntry
  id         String   @id @default(cuid())
  taskId     String
  userId     String
  startedAt  DateTime
  endedAt    DateTime?      // null = running
  minutes    Int?           // set on stop (endedAt-startedAt rounded, min 1)
  note       String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([taskId])
  @@index([userId, endedAt])
```

- Relations added to `Task` (`timeEntries TimeEntry[]`) and `User`
  (`timeEntries TimeEntry[]`).
- **Migration** creates the table AND a raw **partial unique index**:
  `CREATE UNIQUE INDEX "TimeEntry_one_running_per_user" ON "TimeEntry"("userId") WHERE "endedAt" IS NULL;`
  → at most one running timer per user, enforced by the DB (belt-and-braces with the
  auto-stop transaction).
- Deleting a task cascades its entries (task delete is already a deliberate action).

---

## Core logic — `features/time/`

All server-side, Zod-validated, permission-checked via `lib/permissions`. Files:
`schemas.ts`, `actions.ts` (Server Actions), `queries.ts`, `format.ts` (minutes→"2h 30m"),
plus tests.

### Actions
- `startTimer(taskId)` — `requireProjectRole(projectId, "MEMBER")`. In one
  transaction: find the user's running entry (if any) → set its `endedAt = now`,
  `minutes = max(1, round((now-startedAt)/60000))` → create a new running entry
  `{ taskId, userId, startedAt: now }`. Returns `{ started, stopped? }` (stopped =
  the auto-closed entry's task key, for the toast). Revalidate.
- `stopTimer()` — close the user's running entry (`endedAt`, `minutes`). No-op result
  if none running.
- `updateTimeEntry(id, { minutes })` — owner (MEMBER+) or MANAGER/Admin. Only
  completed entries; `minutes` ≥ 1. Revalidate.
- `deleteTimeEntry(id)` — same permission rule. Revalidate.

### Queries
- `getRunningTimer()` — the signed-in user's running entry (task id/key + startedAt)
  or null. Drives the live button across the app.
- `getTaskTime(taskId)` — VIEWER+ on the task's project. Returns:
  - `totalMinutes` (SUM of all completed entries — everyone sees this),
  - `myMinutes` (caller's own),
  - `perUser?: { user, minutes }[]` — **only when caller is MANAGER+/Admin**,
  - `entries` — caller's own entries for a member; **all** entries for a MANAGER+.
  Aggregates via `groupBy`, not row-loading.
- `getProjectTimeReport(projectId)` — VIEWER+. `totalMinutes` + `myMinutes` for all;
  `byUser` + `byTask` breakdowns **only for MANAGER+/Admin**.
- `getMyLoggedHours()` — the signed-in user's minutes this week + by project (for the
  dashboard section). Own data only.
- `getGlobalTimeReport()` — Admin-only. Hours by user across all projects (+ optional
  by-project), `groupBy`.

### Permission matrix (centralised through `lib/permissions` helpers)
| Action | Who |
|---|---|
| start/stop timer, log own time | MEMBER+ (own userId only) |
| edit/delete own entry | owner, if MEMBER+ |
| edit/delete any entry | project MANAGER or Admin |
| view total + own | VIEWER+ |
| view per-user breakdown | project MANAGER or Admin |
| view global report | Admin |

Tests cover: auto-stop-previous transaction, one-running-per-user, stop rounding
(min 1m), member-cannot-edit-others, member-cannot-see-per-user, manager-can.

---

## Views

### 1. Task drawer — "Time" section (`features/time/components/TaskTimeSection.tsx`)
- **Total logged** (everyone) + **"Your time"** (everyone).
- **Timer button** (MEMBER+): Start → Stop toggle; when running on THIS task, shows
  **live ticking elapsed** (client `setInterval`, transform/opacity only, respects
  reduced-motion by falling back to a static "running" state). Uses `getRunningTimer`
  to know if the user's active timer is on this task or another (button label adapts:
  "Start" / "Stop 00:12:31" / "Switch timer here").
- **Per-user breakdown** list (avatar · name · hours) — rendered **only for MANAGER+**.
- **Entries**: a member sees only their own entries (edit minutes / delete); a manager
  sees all, with edit/delete on any.
- Slotted into `TaskDrawer` as a new `DrawerSection` (same pattern as the Watchers
  section), fed from the project page's drawer `Promise.all`.

### 2. Per-project report page (`app/(dashboard)/projects/[projectId]/time/page.tsx`)
- A "Time" tab alongside Board/Backlog (via the existing `ViewTabs`).
- Everyone: project **total** + **my hours**. MANAGER+/Admin: **hours by user** (bar +
  table, reusing the dashboard `getWorkload` chart pattern) and **by task**.
- Guarded by `canViewProject`; the by-user section guarded by MANAGER+.

### 3. Dashboard section (`features/dashboard` + `features/time`)
- A glass "My logged hours" card: **this week** total + a small **by-project**
  breakdown. Own data only, server-fetched with the other KPIs. No heavy motion.

### 4. Admin global report (`app/(dashboard)/admin/time/page.tsx`)
- Admin-only (guarded in `proxy.ts` admin matcher + re-checked in the query).
- Cross-project **hours by user** (table, audit-page pattern), with a project filter.

---

## Formatting & units
- `formatMinutes(min)` → "2h 30m", "45m", "0m". Shared client+server helper.
- Timer input/edit uses minutes under the hood; edit UI accepts "2h 30m" or a minute
  count, parsed by a shared Zod-backed parser.

## Craft / performance
- Aggregates are grouped DB queries — never load all entries into memory.
- The live-elapsed ticker is the only animation; it animates text content, is
  client-only, and never gates data. Dashboard/report first paint is server-rendered
  and immediately interactive (per CLAUDE.md motion rules).

## Sequencing (build parts — independent, staged)
1. Model + migration (incl. partial unique index) + core logic (actions/queries/format)
   + permissions + tests. **[migration here only]**
2. Task-drawer Time section + wiring.
3. Per-project time report page + tab.
4. Dashboard "My logged hours" section.
5. Admin global time report.
