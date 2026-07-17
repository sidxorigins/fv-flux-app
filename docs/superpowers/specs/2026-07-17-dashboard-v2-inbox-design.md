# Dashboard v2 + Inbox — design

**Date:** 2026-07-17
**Status:** Approved, building.

## Goal

Turn the dashboard from a reporting surface into an action surface, and make
notifications first-class:

1. **Inbox** — dedicated `/inbox` page + a dashboard panel + sidebar nav badge.
2. **My work grouped by urgency** — Overdue / Today / This week / Later / No date.
3. **Quick-add task** from the dashboard.
4. **Personal vs team** clarity on widgets + click-through.

No new data model, no migration — all reuse.

## Existing pieces reused

- `Notification` model + `NotificationType` (TASK_ASSIGNED, TASK_COMMENTED,
  TASK_MENTIONED, TASK_STATUS_CHANGED).
- `getMyNotifications(limit)`, `getUnreadNotificationCount()`,
  `markNotificationRead`, `markAllNotificationsRead` (all present).
- `NotificationBell.sentence(n)` type→text formatter → extract to a shared
  `NotificationRow`.
- `getMyTasks()` → BoardTask[] (status/priority/dueDate/projectId/key/title).
- `CreateTaskDialog projects={creatable}` (multi-project picker mode) +
  `getCreatableProjects()`.
- `reminders.classifyDue` day-bucket logic (server-local midnight).

## 1. Inbox

**Data.** Extend `getMyNotifications` with `{ cursor?, unreadOnly?, limit }` →
`{ items, nextCursor }`. Keep the no-arg legacy shape working for the bell (or
add a thin `getNotificationsPage`). Add `getUnreadNotificationCount` to the app
shell for the nav badge.

**Shared row.** `NotificationRow` (client) renders one `NotificationItem`:
actor + sentence + task key/title + relative time + unread dot. Link target:
`/projects/<projectId>?task=<taskId>`. On click, fire `markNotificationRead(id)`
(optimistic) then navigate. Bell, dashboard panel, and `/inbox` all use it.

**`/inbox` page.** Server Component fetches the first page + unread count.
Sections **Unread** / **Earlier**. Controls: **Mark all read**, **Unread only**
toggle (URL param), **Load more** (cursor). Empty state.

**Nav.** Sidebar gets an **Inbox** link with unread-count badge (server-fetched
in the shell). Topbar bell stays.

## 2. My work grouped by urgency

New query `getMyWorkGrouped(scope?)`: my non-DONE assigned tasks (cap ~40),
bucketed server-side by dueDate vs server-local today into
`overdue | today | thisWeek | later | noDate`, each a BoardTask[]. A client
`GroupedWorkList` renders labelled sections (danger/warning/muted heading tints),
reusing the existing inline status dropdown row from MyWorkList. Cap per section
with a total "View all → /tasks". Empty → the existing calm empty state.

## 3. Quick-add

Dashboard header renders `<CreateTaskDialog projects={creatable} />`
(`getCreatableProjects()` added to the page's Promise.all). Non-blocking; if the
user has no creatable projects, hide it.

## 4. Personal vs team

Small `You` / `Team` chips on panel headings (My work + KPIs = You; Throughput,
Workload, Status distribution = Team). KPI cards + chart panels link to the
matching filtered view (`/tasks` or a project backlog with the filter applied).
Presentational only.

## Performance / craft

Server Components fetch everything in the page's existing `Promise.all`; only the
interactive bits (`GroupedWorkList`, Inbox list, quick-add) are client. Keeps the
one entrance animation, no per-row stagger, `transform`/`opacity` only.

## Files

- `src/features/notifications/queries.ts` — page query (cursor/unreadOnly).
- `src/features/notifications/components/NotificationRow.tsx` — shared row.
- `src/features/notifications/components/NotificationBell.tsx` — use shared row.
- `src/app/(dashboard)/inbox/page.tsx` + client list component.
- `src/components/shell/*` (NavLinks/Sidebar) — Inbox link + badge.
- `src/features/dashboard/queries.ts` — `getMyWorkGrouped`.
- `src/features/dashboard/components/GroupedWorkList.tsx`, `InboxPanel.tsx`.
- `src/app/(dashboard)/dashboard/page.tsx` — panel, grouped work, quick-add, labels.

## Tests

- `getMyWorkGrouped` bucketing (overdue/today/thisWeek/later/noDate boundaries).
- notifications page query (unreadOnly filter + cursor).
- Build + browser: /inbox marks read, dashboard panel, grouped work, quick-add.

## Out of scope

Notification preferences/mute, digest settings, reactions, customizable layout,
calendar view — separate asks.
