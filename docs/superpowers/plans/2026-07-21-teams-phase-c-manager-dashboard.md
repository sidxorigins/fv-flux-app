# Teams Org Foundation — Phase C: Manager Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A `/manager` dashboard scoped to the signed-in manager's own teams/projects — KPIs, workload by member, a per-member complete list of active tasks (the headline ask), project progress, team activity — plus letting a manager manage their own team's members (the delegation deferred from Phase B).

**Architecture:** New `features/manager/` (queries + components). Server Components fetch grouped aggregates (mirroring `features/dashboard/queries.ts`), scoped via `managedTeamIds` (Phase A). On-time/late completion is derived from the `status_changed → DONE` ActivityLog timestamp vs the task's `dueDate` (no schema change). Guard: `isManagerOfAnyTeam(me) || admin`. Delegation reuses the existing `addTeamMember`/`removeTeamMember` actions (already `requireTeamManage`).

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Prisma groupBy aggregates, TypeScript strict, Tailwind + tokens/glass, Recharts (already used on the dashboard if present — else simple bars), Vitest.

## Global Constraints
- No `any`. Named exports. Reuse `KpiCard`, `ActivityFeed`, `GroupedWorkList`, `ProjectTiles`, `DashboardEntrance` from `@/features/dashboard/components` where they fit; re-theme nothing away from tokens.
- **Scope every query to the manager's teams/projects** — a manager must never see tasks/members outside teams they manage (`Team.managerId === me`). A global Admin sees all (or all teams). Enforce in the query layer + re-check the page guard.
- **Dashboard performance rules (CLAUDE.md):** aggregate with grouped DB queries (`groupBy`/`count`/`aggregate`), never by loading all tasks into memory; fast first paint; at most one after-paint fade (reuse `DashboardEntrance`), no per-card stagger, no count-up that delays the number; animate transform/opacity only; respect `prefers-reduced-motion`.
- Guard `/manager` server-side (`isManagerOfAnyTeam` / admin) — never rely on hiding the nav link.
- Helpers from Phase A `@/lib/permissions`: `managedTeamIds`, `isManagerOfAnyTeam`, `requireTeamManage`, `requireUser`.

---

### Task C1: Manager scope + aggregate queries

**Files:**
- Create: `src/features/manager/queries.ts`
- Create: `src/features/manager/shape.ts` (pure helpers — on-time bucketing, remaining-hours math)
- Test: `src/features/manager/shape.test.ts`

**Interfaces:**
- `getManagerScope(): Promise<ManagerScope>` — `{ isAdmin, teamIds: string[], projectIds: string[], memberIds: string[], teams: {id,name}[] }`. Resolve managed teams (`Team.managerId === me`, active), their `TeamProject` projectIds, their `TeamMembership` memberIds (+ the manager). Admin → all teams/projects/members. Empty when the user manages nothing.
- `getManagerKpis(scope): Promise<ManagerKpis>` — over tasks in `scope.projectIds`:
  - `assigned` (total), `done`, `todo`, `inProgress`, `inReview`, `overdue` (non-DONE, dueDate < now) — one `groupBy({ by: [status] })` + one overdue count.
  - `completedOnTime` / `completedLate` — see `shape.ts` + the ActivityLog query below.
  - `estimatedHours` (Σ `estimatedHours`), `actualHours` (Σ TimeEntry.minutes / 60), `remainingHours` (`max(0, est - actual)`), `overEstimateCount` (tasks where actual > estimated, both present).
- `getManagerWorkload(scope): Promise<WorkloadRow[]>` — per member: `{ userId, name, username, activeCount, actualHours }` (active = non-DONE assigned). `groupBy(assigneeId)` + a TimeEntry group + one user lookup.
- `getManagerActiveTasksByMember(scope): Promise<MemberActiveTasks[]>` — **the headline.** For every member in scope, the complete list of their non-DONE tasks across `scope.projectIds`: `{ userId, name, username, tasks: { id, key, title, projectKey, status, priority, dueDate, estimatedHours, actualHours }[] }`. One task query (`where assigneeId in memberIds, projectId in projectIds, status != DONE`, include project.key) + one TimeEntry group by taskId, shaped in memory (bounded by the manager's task set). Members with zero active tasks still appear (empty list).
- `getManagerProjectProgress(scope): Promise<ProjectProgress[]>` — per project: `{ projectId, key, name, total, done }` (one `groupBy({ by:[projectId,status] })`).
- `getManagerTeamActivity(scope, limit=20): Promise<ActivityEntry[]>` — recent ActivityLog for tasks in `scope.projectIds` (reuse the existing ActivityLog row shape the dashboard `ActivityFeed` consumes).

- [ ] **Step 1: Write failing tests** — `src/features/manager/shape.test.ts` for the pure helpers:
  - `bucketCompletion(dueDate, completedAt)` → `"on_time" | "late" | "no_due"` (late iff both present and `completedAt > dueDate`).
  - `remainingHours(est, actual)` → `max(0, est - actual)`, `0` when est is null.
  - `isOverEstimate(est, actual)` → true iff both present and `actual > est`.

- [ ] **Step 2: Run — fail.** `npx vitest run src/features/manager/shape.test.ts`

- [ ] **Step 3: Implement `shape.ts`** (pure):
```ts
export type CompletionBucket = "on_time" | "late" | "no_due";
export function bucketCompletion(dueDate: Date | null, completedAt: Date | null): CompletionBucket {
  if (!dueDate || !completedAt) return "no_due";
  return completedAt.getTime() > dueDate.getTime() ? "late" : "on_time";
}
export function remainingHours(estimated: number | null, actual: number): number {
  if (estimated == null) return 0;
  return Math.max(0, estimated - actual);
}
export function isOverEstimate(estimated: number | null, actual: number): boolean {
  return estimated != null && actual > estimated;
}
```

- [ ] **Step 4: Implement `queries.ts`.** Mirror `src/features/dashboard/queries.ts` exactly for style (grouped queries, zero-filling, narrow selects). Read that file first. Key details:
  - `getManagerScope` uses `requireUser()` then `prisma.team.findMany({ where: { managerId: me.id, isActive: true }, select: { id, name, projects:{select:{projectId}}, members:{select:{userId}} } })`; admin (`globalRole==="ADMIN"`) → all active teams (or all projects). Dedup projectIds/memberIds via `Set`.
  - **On-time/late:** query `prisma.activityLog.findMany({ where: { field: "status", newValue: "DONE", task: { projectId: { in: projectIds } } }, select: { taskId, createdAt, task: { select: { dueDate } } }, orderBy: { createdAt: "desc" } })`, keep the LATEST DONE-transition per taskId, then `bucketCompletion(dueDate, createdAt)` and tally. (Only DONE tasks with a dueDate contribute to on-time vs late.)
  - Actual hours: `prisma.timeEntry.aggregate/groupBy` summing `minutes` for tasks in scope; convert to hours (`/60`, round to 1 dp).
  - Guard against an EMPTY scope (`projectIds.length === 0`) → return zeroed KPIs / empty lists WITHOUT running `in: []` queries.

- [ ] **Step 5: Run — pass** (shape tests) and `npx tsc --noEmit`.

- [ ] **Step 6: Commit** `feat(manager): scope + aggregate queries for the manager dashboard`

---

### Task C2: `/manager` dashboard page + UI + nav

**Files:**
- Create: `src/app/(dashboard)/manager/page.tsx` (RSC, guarded)
- Create: `src/features/manager/components/MemberActiveTasks.tsx` (client — collapsible per-member list)
- Create: `src/features/manager/components/WorkloadBars.tsx`, `ProjectProgressList.tsx` (client or RSC as needed)
- Modify: `src/components/shell/NavLinks.tsx` (+ `MobileNav.tsx` if it has its own list) — add a "Manager" link shown only when the user manages a team or is admin

**Interfaces:** consumes C1 queries + `@/features/dashboard/components` (`KpiCard`, `ActivityFeed`, `DashboardEntrance`).

- [ ] **Step 1: Page guard + fetch** — `manager/page.tsx`: `const me = await requireUser()`; if `!(await isManagerOfAnyTeam(me.id)) && me.globalRole !== "ADMIN"` → `notFound()` (or a friendly "You don't manage any teams yet" empty state). Fetch scope + all six aggregates in parallel (`Promise.all`). Wrap the content in `DashboardEntrance` (the one after-paint fade) like the personal dashboard.
- [ ] **Step 2: KPI row** — `KpiCard`s: Assigned, Done, In progress, Overdue (danger), On-time vs Late, Actual hrs, Remaining hrs, Over estimate. Use functional colours (overdue = danger, done = success, in-progress = info). Numbers render immediately (no count-up gating).
- [ ] **Step 3: Workload** — `WorkloadBars`: horizontal bars per member (active count; hours as caption). transform/opacity only.
- [ ] **Step 4: Per-member active tasks** — `MemberActiveTasks`: each member is a collapsible group (name + active count); expanded shows a compact table of their non-DONE tasks (key, title, project, status badge, priority badge, due date, est/actual hrs). Empty member → "No active tasks." This is the centerpiece — make it scannable and dense. Reuse `StatusBadge`/`PriorityBadge` from `@/features/tasks/components`.
- [ ] **Step 5: Project progress + activity** — `ProjectProgressList` (done/total bar per project) + reuse `ActivityFeed` for `getManagerTeamActivity`.
- [ ] **Step 6: Nav link** — in `NavLinks.tsx`, add `{ href: "/manager", label: "Manager" }` gated on a prop like `showManager` (the shell layout computes it via `isManagerOfAnyTeam || admin` and passes down). Do NOT show it to non-managers.
- [ ] **Step 7: Verify** `npx tsc --noEmit && npm run lint && npx vitest run && npm run build` — all green, `/manager` route registered.
- [ ] **Step 8: Commit** `feat(manager): /manager dashboard page + KPIs + per-member active tasks + nav`

---

### Task C3: Manager team-member delegation

**Files:**
- Create: `src/features/manager/queries.ts` addition `getManagerTeams()` (manager's teams + members) — or extend scope
- Modify: `src/features/admin/queries.ts` OR create `src/features/manager/queries.ts` — a manager-safe assignable-users list `listAssignableUsersForManager()` (active users, id/name/username only) gated by `requireUser` (a manager needs names to add members; low-sensitivity)
- Create: `src/features/manager/components/ManagerTeamMembers.tsx` (client) + a `/manager/teams/[teamId]` page OR a "My teams" section on `/manager`

**Interfaces:** reuses `addTeamMember` / `removeTeamMember` (`requireTeamManage`, already built in Phase B).

- [ ] **Step 1:** Add `listAssignableUsersForManager()` — `requireUser()` then return active users `{ id, name, username }` (no email/role/status leak). This lets a team manager pick users to add without admin access.
- [ ] **Step 2:** On `/manager` (a "My teams" section) or `/manager/teams/[teamId]`, render `ManagerTeamMembers` for each team the manager manages: list members + remove buttons + an "Add member" `Combobox` (from `listAssignableUsersForManager`), wired to `addTeamMember`/`removeTeamMember`. Server enforces `requireTeamManage`; the UI is a convenience. `router.refresh()` + toast on error.
- [ ] **Step 3: Verify** `npx tsc --noEmit && npm run lint && npx vitest run` green.
- [ ] **Step 4: Commit** `feat(manager): manager can manage own-team members (delegation)`

## Self-Review notes
- Coverage: scope + all KPIs (C1), dashboard UI incl the per-member active-task list (C2), delegation (C3). The spec's #5 dashboard items map to C1/C2; the Phase-B deferred delegation lands in C3.
- On-time/late uses the ActivityLog DONE-transition timestamp — accurate, no schema change. Documented approximation: only DONE tasks with a dueDate contribute.
- Every query scoped to `managedTeamIds`; empty-scope guarded (no `in: []`). Admin sees all.
- Perf: grouped queries only; one after-paint fade; no stagger/count-up. Matches CLAUDE.md dashboard rules.
