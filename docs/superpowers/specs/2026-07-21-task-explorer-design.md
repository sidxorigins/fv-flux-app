# Design — Task Explorer / Advanced Filters (Feature #3)

Date: 2026-07-21
Branch: `feat/task-explorer`
Source: Flux_Proposed_New_Features.docx #3.

A new cross-project `/explore` view: filter every task the user can access by a rich
filter set, and save filter combinations. Permission-scoped so it never leaks tasks from
projects the user can't see.

## Locked decisions
- **New `/explore` page** — cross-project, not the per-project backlog (which keeps its own
  filters + `SavedView`).
- **Permission scope first, always:** the base set is tasks in projects the user can access
  (their `ProjectMembership` projectIds; admin → all). Every filter narrows *within* that set.
- **Filters:** Project · Team · Manager · Project Lead · Assignee (+ unassigned) · Type ·
  Status · Priority · Tags(labels) · Due-date range · Created-date range · Overdue · No estimate ·
  Over estimate. URL-driven (querystring), like the backlog.
- **Save combos:** a new per-user global `SavedFilter` model (the existing `SavedView` is
  per-project and stays as-is).
- **Deferred (no backing field):** Department (no model); Start-date / Completed-date filters
  (no `startDate`/`completedAt` — that's #10). Shown as "coming with task timeline."

## Data model
- New `SavedFilter { id, userId, name, query (String), createdAt }` — per-user, global (no
  projectId). `user User @relation(onDelete: Cascade)`, `@@index([userId])`. Additive migration.

## Server (`features/explore/`)
- **`resolveAccessibleProjectIds()`** — reuse the dashboard scope logic: the user's membership
  projectIds, or ALL project ids for a global Admin.
- **`resolveExploreProjectIds(filters, accessibleIds)`** — start from `accessibleIds`, then
  intersect (AND) with each org filter that's set:
  - `projectId` → `[projectId]` (if in accessible).
  - `teamId` → `TeamProject.projectId where teamId`.
  - `managerId` → project ids of teams where `managerId` (via TeamProject).
  - `leadId` → projects where `leadId === leadId` OR a `ProjectLead` row for that user.
  Returns the narrowed, still-permitted project id set.
- **`exploreFilterSchema`** (Zod) — parse/validate all filter params from the querystring
  (enums for type/status/priority; ids; ISO date strings for the ranges; booleans for the flags).
- **`exploreTaskWhere(filters, projectIds)`** — Prisma `where`: `projectId in projectIds` +
  `assigneeId` (in / null for unassigned) + `type`/`status`/`priority` + `labels some id` +
  `dueDate gte/lte` + `createdAt gte/lte` + overdue (`status != DONE AND dueDate < now`) +
  noEstimate (`estimatedHours = null`).
- **Over-estimate pre-pass** — when `overEstimate` is set: over the tasks matching the base
  where that have `estimatedHours != null`, `groupBy(taskId)` sum `TimeEntry.minutes`, keep ids
  where `minutes/60 > estimatedHours`; AND `id in (those)` into the where. (Two-step; bounded by
  the other filters + permission scope.)
- **`getExploreTasks(filters, page, pageSize=25)`** — resolve scope → where → `findMany`
  (include project.key, assignee, labels) with `take`/`skip` + a `count` for total. Returns
  `{ tasks, total, page, pageSize }`. Each task carries `projectId` for deep-linking.
- **`getExploreFilterOptions()`** — the dropdown data scoped to accessible projects: projects,
  teams (active), managers (distinct team managers), leads (distinct project leads), assignees
  (distinct members), labels. Enums (type/status/priority) are static.
- **Empty accessible set** (a user with no project access) → the page shows the "no projects"
  empty state; queries short-circuit (no `in: []` that matches everything).

## SavedFilter actions (`features/explore/actions.ts`)
- `createSavedFilter({ name, query })` — `requireUser`; own; caps (name ≤ 60, query length capped);
  returns the row. `deleteSavedFilter(id)` — owner-only. `listSavedFilters()` — the user's own.
  Mirror `features/saved-views/actions.ts` (owner-only semantics, ActionResult).

## UI
- **`/explore` page** (RSC shell) — reads filters from `searchParams`, fetches options + the
  page of results on the server. A `'use client'` `ExploreFilterBar` writes filters to the URL
  (like the backlog's filter controls); results render server-side per URL.
- **`ExploreFilterBar`** — compact controls: selects for Project / Team / Manager / Project Lead /
  Assignee / Type / Status / Priority / Tag; two date-range pairs (Due, Created); three toggles
  (Overdue, No estimate, Over estimate); a "Clear" button; and a **Saved filters** popover
  (save current querystring under a name / apply / delete — reuse the `TaskFilters` views popover
  pattern). Show active-filter count.
- **Results** — a task table (key, title, project key, assignee, status, priority, due, est/actual
  hrs) reusing `StatusBadge`/`PriorityBadge`/`AssigneeAvatar`; each row links to
  `/projects/{projectId}?task={id}`. Simple prev/next pagination with the total count.
- **Nav** — an "Explore" link in the shell for all authed users.

## Security
- The permitted project set is computed server-side from the session user's memberships (admin
  bypass) BEFORE any filter; filters can only narrow it. A crafted `teamId`/`projectId`/`managerId`
  that resolves to projects the user can't access yields the empty intersection — never a leak.
  All inputs Zod-validated. `SavedFilter` is owner-scoped (create/list/delete gated to the owner).

## Tests
- `exploreTaskWhere`: each filter maps to the right clause; overdue/noEstimate/unassigned; date
  ranges; combined filters AND correctly.
- `resolveExploreProjectIds`: org filters intersect with accessible (a team/manager/lead outside
  the accessible set → empty); no filter → full accessible set.
- Over-estimate id computation: actual > estimated selected; equal/under excluded; no-estimate excluded.
- `SavedFilter` actions: create own, delete owner-only (another user can't delete), list own only.

## Sequencing
1. `features/explore/` query layer — schema + resolveAccessibleProjectIds + resolveExploreProjectIds
   + exploreTaskWhere + over-estimate + getExploreTasks + getExploreFilterOptions + tests.
2. `SavedFilter` model + migration + actions + tests.
3. `/explore` page + `ExploreFilterBar` + results table + saved-filters popover + pagination + nav.
