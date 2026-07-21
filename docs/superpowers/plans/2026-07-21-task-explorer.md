# Task Explorer / Advanced Filters (#3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A permission-scoped `/explore` view to filter every task the user can access by a rich filter set, with saved filter combos.

**Architecture:** `features/explore/` (Zod filter schema + accessible-project resolution + org-filter → project-set resolution + where-builder + over-estimate pre-pass + paginated query + options). New per-user `SavedFilter` model + owner-scoped actions. A `/explore` page (RSC shell + client filter bar writing to the URL) with a results table + saved-filters popover + nav link.

**Tech Stack:** Next.js 16 App Router, Prisma, TypeScript strict, Tailwind tokens/glass, Vitest.

## Global Constraints
- No `any`. Named exports. Permission scope is computed server-side from the session user's memberships (admin → all) BEFORE any filter; filters only narrow it — never trust a client project/team/manager id to widen access.
- Migrations only; inspect SQL for a stray TimeEntry partial-index DROP and delete it (memory `timeentry-partial-index`).
- Reuse: dashboard scope logic (`src/features/dashboard/queries.ts` `getDashboardScope`), the backlog table + `StatusBadge`/`PriorityBadge`/`AssigneeAvatar` (`@/features/tasks/components`), the saved-views popover pattern (`src/features/tasks/components/TaskFilters.tsx` + `src/features/saved-views/actions.ts`).
- Guard empty accessible set (no `{ in: [] }` that matches everything).

---

### Task 1: `features/explore/` query layer

**Files:**
- Create: `src/features/explore/schemas.ts`, `src/features/explore/queries.ts`, `src/features/explore/filter-where.ts`
- Test: `src/features/explore/filter-where.test.ts`, `src/features/explore/resolve.test.ts`

**Interfaces:**
- `exploreFilterSchema` (Zod) → `ExploreFilters` `{ projectId?, teamId?, managerId?, leadId?, assigneeId?, unassigned?: boolean, type?, status?, priority?, labelId?, dueFrom?, dueTo?, createdFrom?, createdTo?, overdue?: boolean, noEstimate?: boolean, overEstimate?: boolean }`.
- `resolveAccessibleProjectIds(): Promise<{ ids: string[]; isAdmin: boolean }>`
- `resolveExploreProjectIds(filters: ExploreFilters, accessible: string[]): Promise<string[]>`
- `exploreTaskWhere(filters: ExploreFilters, projectIds: string[], now: Date): Prisma.TaskWhereInput`
- `getExploreTasks(filters, page: number, pageSize?: number): Promise<{ tasks: ExploreTaskRow[]; total: number; page: number; pageSize: number }>`
- `getExploreFilterOptions(): Promise<ExploreOptions>`

- [ ] **Step 1: Write failing tests** — `filter-where.test.ts` (pure `exploreTaskWhere`): given filters, assert the produced `where` — `projectId: { in }`, `assigneeId: null` when `unassigned`, `assigneeId: { in: [id] }` when assignee set, `type`/`status`/`priority` equality, `labels: { some: { id } }`, `dueDate: { gte, lte }`, `createdAt: { gte, lte }`, overdue → `status: { not: "DONE" }, dueDate: { lt: now }`, noEstimate → `estimatedHours: null`. Combined filters coexist (no clobber). `resolve.test.ts` covers `resolveExploreProjectIds` intersection using a mocked prisma (mirror `admin/actions.test.ts` mock style): team/manager/lead outside the accessible set → `[]`; no org filter → the accessible set unchanged.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: `schemas.ts`** — `exploreFilterSchema` with `z.coerce.date().optional()` for the range fields, `z.enum(...)` (from `@/generated/prisma/enums`) for type/status/priority, `z.string().min(1).optional()` for ids, `z.coerce.boolean().optional()` (or presence-based) for the flags. Export `ExploreFilters = z.infer<...>`. Add a `parseExploreFilters(searchParams: URLSearchParams | Record<string,string|string[]>)` helper that safe-parses into `ExploreFilters` (ignoring unknown/blank).

- [ ] **Step 4: `filter-where.ts`** — pure `exploreTaskWhere(filters, projectIds, now)` building the `Prisma.TaskWhereInput` per the test. Combine date bounds into one object; overdue AND noEstimate coexist with an explicit `status`. Keep it a pure function (no prisma).

- [ ] **Step 5: `queries.ts`**
  - `resolveAccessibleProjectIds`: `requireUser`; if admin → `prisma.project.findMany({ select: { id } })` ids; else `prisma.projectMembership.findMany({ where: { userId }, select: { projectId } })` → projectIds. (Reuse/mirror `getDashboardScope`.)
  - `resolveExploreProjectIds(filters, accessible)`: `let ids = new Set(accessible)`. If `filters.projectId` → intersect with `{projectId}`. If `teamId` → `teamProject.findMany({ where:{teamId}, select:{projectId} })` → intersect. If `managerId` → `teamProject.findMany({ where:{ team:{ managerId } }, select:{projectId} })` → intersect. If `leadId` → `project.findMany({ where:{ OR:[{leadId},{additionalLeads:{some:{userId:leadId}}}] }, select:{id} })` → intersect. Return `[...ids]`.
  - `getExploreTasks(filters, page, pageSize=25)`: `const { ids } = await resolveAccessibleProjectIds()`; if `ids.length===0` → return empty. `const projectIds = await resolveExploreProjectIds(filters, ids)`; if empty → empty result. `let where = exploreTaskWhere(filters, projectIds, new Date())`. **Over-estimate pre-pass:** if `filters.overEstimate`, fetch candidate tasks (`where` + `estimatedHours: { not: null }`, select `id, estimatedHours`), `timeEntry.groupBy({ by:['taskId'], where:{ taskId:{ in: candidateIds } }, _sum:{ minutes:true } })`, keep ids where `(_sum.minutes ?? 0)/60 > estimatedHours`; set `where = { AND: [where, { id: { in: matchingIds } }] }` (empty → return empty). Then `Promise.all([ prisma.task.findMany({ where, include:{ project:{select:{key:true}}, assignee:{select:USER_BASIC}, labels:true }, orderBy:[{updatedAt:'desc'}], take:pageSize, skip:(page-1)*pageSize }), prisma.task.count({ where }) ])`. Map to `ExploreTaskRow` (id, key, title, projectId, projectKey, assignee, status, priority, dueDate, estimatedHours, actualHours?). (actualHours optional — omit for perf unless cheap; the row shows est + status.)
  - `getExploreFilterOptions()`: over accessible projectIds — projects `{id,key,name}`, teams (active) `{id,name}`, managers (distinct `team.manager` of active teams touching accessible projects) `{id,name}`, leads (distinct leads of accessible projects) `{id,name}`, assignees (distinct members of accessible projects) `{id,name,username}`, labels `{id,name,colour}`.

- [ ] **Step 6: Run — pass.** `npx tsc --noEmit && npx vitest run src/features/explore`

- [ ] **Step 7: Commit** `feat(explore): filter schema + permission-scoped query layer`

---

### Task 2: `SavedFilter` model + actions

**Files:**
- Modify: `prisma/schema.prisma` (+ `User.savedFilters`)
- Migration: `prisma/migrations/*_saved_filter/`
- Create: `src/features/explore/saved-filter-schemas.ts`, `src/features/explore/saved-filter-actions.ts`
- Test: `src/features/explore/saved-filter-actions.test.ts`

- [ ] **Step 1: Schema** — add:
```prisma
model SavedFilter {
  id        String   @id @default(cuid())
  userId    String
  name      String
  query     String
  createdAt DateTime @default(now())
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}
```
+ `savedFilters SavedFilter[]` on `User`.
- [ ] **Step 2: Migrate** — `npx prisma migrate dev --name saved_filter`; inspect SQL (additive; delete any TimeEntry DROP INDEX line).
- [ ] **Step 3: Zod** — `createSavedFilterSchema { name: z.string().trim().min(1).max(60), query: z.string().max(2000) }`, `deleteSavedFilterSchema { id: z.string().min(1) }`.
- [ ] **Step 4: Actions** (mirror `features/saved-views/actions.ts`): `createSavedFilter(input)` — `requireUser`, create `{ userId, name, query }`, return the row. `deleteSavedFilter(id)` — `requireUser`, load the row, **owner-only** (`row.userId === user.id` else `{ ok:false }`), delete. `listSavedFilters()` — the caller's own, `orderBy createdAt desc`. Use the `ActionResult` convention.
- [ ] **Step 5: Test** — create own; delete owner-only (a different user id can't delete — assert refused, no delete); list returns only own. Mirror the admin/actions.test.ts mock style (`@/lib/db`, `@/lib/permissions` mocked; add `savedFilter` to the db mock).
- [ ] **Step 6: Verify + commit** — `npx tsc --noEmit && npx vitest run src/features/explore` → commit `feat(explore): SavedFilter model + owner-scoped actions`.

---

### Task 3: `/explore` page + filter bar + results + saved filters + nav

**Files:**
- Create: `src/app/(dashboard)/explore/page.tsx`, `src/features/explore/components/ExploreFilterBar.tsx`, `ExploreResults.tsx`, `SavedFilterMenu.tsx`
- Modify: `src/components/shell/NavLinks.tsx` (+ mobile) — add `{ href: "/explore", label: "Explore" }`

- [ ] **Step 1: Page** (RSC) — `await searchParams`; `parseExploreFilters` → filters; `const page = Number(sp.page ?? 1)`. `Promise.all([ getExploreFilterOptions(), getExploreTasks(filters, page), listSavedFilters() ])`. If the accessible set is empty → friendly empty state. Render `ExploreFilterBar` (options + current filters + saved filters) above `ExploreResults` (tasks + total + pagination).
- [ ] **Step 2: `ExploreFilterBar`** (`'use client'`) — controls for each filter writing to the URL via `useRouter().replace(pathname + '?' + params)` (debounce text/date; selects immediate). Reuse `Select`/`Combobox`/`Button`/date `input[type=date]`. A "Clear all" resets to `/explore`. Show an active-filter count. Include `SavedFilterMenu`.
- [ ] **Step 3: `SavedFilterMenu`** — popover: list `listSavedFilters()` results (apply → push `/explore?<query>`; delete → `deleteSavedFilter`); a "Save current" input capturing `searchParams.toString()` → `createSavedFilter`. Mirror the `TaskFilters` views popover.
- [ ] **Step 4: `ExploreResults`** — a table (key, title, project, assignee, status, priority, due, est hrs) reusing `StatusBadge`/`PriorityBadge`/`AssigneeAvatar`; each row is a link to `/projects/{projectId}?task={id}`. Prev/next pagination using `total`/`page`/`pageSize` (preserve the current filters in the page links). Empty results → "No tasks match these filters."
- [ ] **Step 5: Nav** — add the "Explore" link to `NavLinks.tsx` (all authed users; no gating).
- [ ] **Step 6: Verify + commit** — `npx tsc --noEmit && npm run lint && npx vitest run && npm run build` (all green, `/explore` registered) → commit `feat(explore): /explore page + filter bar + results + saved filters + nav`.

## Self-Review notes
- Coverage: query layer + over-estimate (T1), SavedFilter + owner-scoped actions (T2), page/bar/results/save/nav (T3).
- Security: permission scope computed before filters; org filters only intersect; SavedFilter owner-only. Empty-scope guarded.
- Deferred filters (Department, start/completed date) intentionally omitted — noted in the spec.
