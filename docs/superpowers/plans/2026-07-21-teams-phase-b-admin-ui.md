# Teams Org Foundation — Phase B: Admin Teams Module + Project Lead UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Admin-facing Teams module (`/admin/teams`) — create/edit/activate teams, assign a manager, manage members (delegated to the team manager), assign teams to projects with a role — plus multiple-Project-Lead management, all routed through the Phase-A access-sync engine + AuditLog.

**Architecture:** New Zod schemas + server actions + queries in `src/features/admin/` (mirroring the existing users/invites/project-access pattern). Every membership-affecting mutation runs inside a `$transaction` that calls `recomputeForTeam`/`recomputeMembership` (Phase A) then writes an `AuditLog`. UI mirrors the existing admin components (`ProjectMembersEditor`, `ProjectRoleSelect`, `Combobox`, `CursorPager`, `AdminNav`).

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Prisma, TypeScript strict, Tailwind + Base UI/shadcn, Vitest.

## Global Constraints
- No `any`. Named exports. Server actions return the existing `ActionResult` (`{ ok: true } | { ok: false, error }`) shape used in `src/features/admin/actions.ts`.
- **Authorisation on the server, every action:** team CRUD + manager assignment + team↔project + lead assignment = `requireAdmin`; add/remove team member = `requireTeamManage(teamId)` (admin OR the team's manager). Use the Phase-A helpers in `@/lib/permissions`.
- Every mutation: Zod-validate input → authorise → `$transaction` (mutate + `recompute*` + `auditLog.create`) → `revalidatePath`. Never trust a role/id from the client beyond validation.
- Reuse existing components: `ProjectRoleSelect`, `Combobox` (user picker), `CursorPager`, and mirror `ProjectMembersEditor` for the team editors. Re-theme any new component to tokens/glass — no default shadcn slate.
- Recompute imports: `recomputeForTeam`, `recomputeMembership` from `@/lib/access-sync`.
- AuditLog actions (new strings): `team.created`, `team.updated`, `team.activated`, `team.deactivated`, `team.manager_assigned`, `team.member_added`, `team.member_removed`, `team.project_assigned`, `team.project_role_changed`, `team.project_unassigned`, `lead.added`, `lead.removed`, `lead.primary_changed`.

---

### Task B1: Team schemas + CRUD actions + queries

**Files:**
- Modify: `src/features/admin/schemas.ts` (add team schemas)
- Modify: `src/features/admin/actions.ts` (add team CRUD actions)
- Modify: `src/features/admin/queries.ts` (add team queries + types)
- Test: `src/features/admin/actions.test.ts` (append team-action tests, same mock style)

**Interfaces:**
- Produces schemas: `createTeamSchema` `{ name: string(1..80), description?: string(<=500) }`, `updateTeamSchema` `{ teamId, name?, description?, isActive? }`, `assignTeamManagerSchema` `{ teamId, managerId: string | null }`.
- Produces actions: `createTeam`, `updateTeam`, `assignTeamManager` (all `(input:unknown)=>Promise<ActionResult>`).
- Produces queries: `getTeams(): Promise<AdminTeamRow[]>` (id, name, isActive, managerName|null, memberCount, projectCount), `getTeam(teamId): Promise<AdminTeamDetail | null>` (team + manager + members[{userId,name,username}] + projects[{projectId, key, name, role, leads:[names]}]).

- [ ] **Step 1: Write failing tests** — `createTeam` (admin only; writes `team.created` audit); `updateTeam` activate/deactivate writes `team.activated`/`team.deactivated`; `assignTeamManager` sets managerId, calls `recomputeForTeam`, audits `team.manager_assigned`; non-admin → `{ ok:false }`. Mirror the mock setup already at the top of `actions.test.ts` (it already mocks `@/lib/db`, `@/lib/permissions`, `next/cache`; add `vi.mock("@/lib/access-sync", () => ({ recomputeForTeam: vi.fn(), recomputeMembership: vi.fn() }))` if not present, and add `team` + `teamMembership` + `teamProject` + `projectLead` models to the `@/lib/db` mock's model factory).

- [ ] **Step 2: Run — fail.** `npx vitest run src/features/admin/actions.test.ts`

- [ ] **Step 3: Implement schemas** (in `schemas.ts`):
```ts
export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
});
export const updateTeamSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});
export const assignTeamManagerSchema = z.object({
  teamId: z.string().min(1),
  managerId: z.string().min(1).nullable(),
});
```

- [ ] **Step 4: Implement actions** (in `actions.ts`, mirroring `addProjectMember`'s shape — `requireAdmin`, `$transaction`, audit). `createTeam`: create the row, audit `team.created`. `updateTeam`: apply provided fields; when `isActive` toggles, audit `team.activated`/`team.deactivated` (else `team.updated`); **if `isActive` changed, call `recomputeForTeam(tx, teamId)`** (inactive teams grant no access — see A2 which filters `team.isActive`). `assignTeamManager`: validate the target user exists (if non-null) and is ACTIVE; set `managerId`; `recomputeForTeam(tx, teamId)` (old+new manager access changes); audit `team.manager_assigned` with `{ teamId, managerId }`. Each ends with `revalidatePath("/admin/teams")` and (detail) `revalidatePath(\`/admin/teams/${teamId}\`)`.

- [ ] **Step 5: Implement queries** (in `queries.ts`): `getTeams` (findMany + `_count` members/projects + manager name), `getTeam` (include members→user, projects→project + that project's leads). Export the `AdminTeamRow`/`AdminTeamDetail` types.

- [ ] **Step 6: Run — pass.** Then `npx tsc --noEmit`.

- [ ] **Step 7: Commit** `feat(teams): team CRUD actions + queries + schemas`

---

### Task B2: Team membership + project-assignment actions

**Files:**
- Modify: `src/features/admin/schemas.ts`, `src/features/admin/actions.ts`
- Test: `src/features/admin/actions.test.ts` (append)

**Interfaces:**
- Schemas: `teamMemberSchema` `{ teamId, userId }`, `teamProjectSchema` `{ teamId, projectId, role: ProjectRole }`, `teamProjectRoleSchema` `{ teamId, projectId, role }`, `teamProjectRemoveSchema` `{ teamId, projectId }`.
- Actions: `addTeamMember`, `removeTeamMember` (auth `requireTeamManage`), `assignTeamProject`, `updateTeamProjectRole`, `unassignTeamProject` (auth `requireAdmin`).

- [ ] **Step 1: Write failing tests** — `addTeamMember` creates the `TeamMembership`, calls `recomputeMembership` for each of the team's projects (assert called per project), audits `team.member_added`; `removeTeamMember` deletes + recomputes + audits; `requireTeamManage` enforced (a team manager can add to their own team, a stranger cannot); `assignTeamProject` creates `TeamProject` + `recomputeForTeam`/per-member recompute + audit; `updateTeamProjectRole` changes role + recompute; `unassignTeamProject` deletes + recompute (members lose that team's grant unless justified elsewhere).

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement.**
- `addTeamMember`/`removeTeamMember`: `requireTeamManage(teamId)`; in a `$transaction`, upsert/delete the `TeamMembership`, then recompute the affected user across the team's projects — fetch `team.projects` and call `recomputeMembership(tx, projectId, userId)` for each (or `recomputeForTeam` — but per-user is cheaper; loop the team's projectIds). Audit.
- `assignTeamProject`: `requireAdmin`; create `TeamProject { teamId, projectId, role }` (unique — reject/So idempotent-upsert), then `recomputeForTeam(tx, teamId)` (all members+manager × the new project — simplest correct call is to recompute that one project for the team's people; use `recomputeMembership` looped over team members+manager for `projectId`). Audit `team.project_assigned`.
- `updateTeamProjectRole`: `requireAdmin`; update the role; recompute the team's members for that project. Audit `team.project_role_changed` with from/to.
- `unassignTeamProject`: `requireAdmin`; capture the members+manager first, delete the `TeamProject`, then `recomputeMembership` for each of those users × `projectId` (now the team no longer justifies access). Audit `team.project_unassigned`.
- (Validate that team + project + user exist; friendly errors like the existing actions.)

- [ ] **Step 4: Run — pass.** Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit** `feat(teams): team member + project-assignment actions (recompute + audit)`

---

### Task B3: Project Lead actions + queries

**Files:**
- Modify: `src/features/admin/schemas.ts`, `src/features/admin/actions.ts`, `src/features/admin/queries.ts`
- Test: `src/features/admin/actions.test.ts` (append)

**Interfaces:**
- Schemas: `projectLeadSchema` `{ projectId, userId }`, `setPrimaryLeadSchema` `{ projectId, userId }`.
- Actions: `addProjectLead`, `removeProjectLead`, `setPrimaryLead` (all `requireAdmin`).
- Query: `getProjectLeads(projectId): Promise<{ primaryLeadId: string; leads: { userId, name, username, isPrimary }[] }>`.

- [ ] **Step 1: Write failing tests** — `addProjectLead` creates a `ProjectLead` row (idempotent), `recomputeMembership(tx, projectId, userId)` (lead → MANAGER), audits `lead.added`; `removeProjectLead` deletes the `ProjectLead` row + recompute (downgrades/removes derived access) + audit; **`removeProjectLead` must refuse to remove the current primary `Project.leadId`** (the primary can't be left empty — return an error telling the admin to reassign primary first); `setPrimaryLead` updates `Project.leadId` (and ensures the new primary has a `ProjectLead` row), recomputes old+new primary, audits `lead.primary_changed`.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement.**
- `addProjectLead`: `requireAdmin`; validate user exists+ACTIVE; upsert `ProjectLead` (unique on `[projectId,userId]`); `recomputeMembership(tx, projectId, userId)`; audit.
- `removeProjectLead`: `requireAdmin`; if `userId === project.leadId` → `{ ok:false, error:"Reassign the primary lead before removing them." }`; else delete the `ProjectLead` row, `recomputeMembership`, audit.
- `setPrimaryLead`: `requireAdmin`; ensure a `ProjectLead` row exists for the new primary (create if missing); set `Project.leadId = userId`; `recomputeMembership` for both the old and new primary; audit `lead.primary_changed` `{ from, to }`.
- `getProjectLeads`: read `project.leadId` + all `ProjectLead` rows (join user); mark `isPrimary` where `userId === leadId`.

- [ ] **Step 4: Run — pass.** Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit** `feat(leads): multiple project-lead actions + query (recompute + audit)`

---

### Task B4: `/admin/teams` UI (list + detail) + nav

**Files:**
- Create: `src/app/(dashboard)/admin/teams/page.tsx` (list — RSC)
- Create: `src/app/(dashboard)/admin/teams/[teamId]/page.tsx` (detail — RSC)
- Create: `src/features/admin/components/TeamsTable.tsx`, `CreateTeamDialog.tsx`, `TeamDetailEditor.tsx` (client editors)
- Modify: `src/features/admin/components/AdminNav.tsx` (add `{ href: "/admin/teams", label: "Teams" }` after "Project access")

**Interfaces:**
- Consumes B1/B2 actions + `getTeams`/`getTeam`; reuses `ProjectRoleSelect`, `Combobox`, `CursorPager`.

- [ ] **Step 1: Add the nav tab** to `AdminNav.tsx` `TABS`.
- [ ] **Step 2: List page** — RSC guarded by `requireAdmin` (mirror `admin/projects/page.tsx`): render `TeamsTable` (name → link to detail, manager, member/project counts, active badge) + a "New team" `CreateTeamDialog` (calls `createTeam`, then `router.refresh()`).
- [ ] **Step 3: Detail page** — RSC (`requireAdmin`; a team manager may also view/manage — allow if `canManageTeam`): `getTeam(teamId)`; render `TeamDetailEditor`:
  - Details: editable name/description + activate/deactivate toggle (calls `updateTeam`).
  - Manager: `Combobox` user picker → `assignTeamManager` (clearable → null).
  - Members: list + add (`Combobox`) / remove, wired to `addTeamMember`/`removeTeamMember` (mirror `ProjectMembersEditor`). Visible/editable to admin or the team's manager.
  - Projects: list assigned projects each with a `ProjectRoleSelect` (→ `updateTeamProjectRole`) + remove (→ `unassignTeamProject`), and an "Assign project" control (project `Combobox` + role) → `assignTeamProject`. Admin-only controls.
  - Each project row shows that project's lead names (read-only here; managed on the project page).
- [ ] **Step 4: Verify** `npx tsc --noEmit && npm run lint && npx vitest run` (all green; no server tests for pure UI, but build must pass). Manually reason the actions are wired.
- [ ] **Step 5: Commit** `feat(teams): /admin/teams list + detail UI + nav`

---

### Task B5: Project Lead management UI

**Files:**
- Modify: `src/app/(dashboard)/admin/projects/[projectId]/page.tsx` (add a leads section)
- Create: `src/features/admin/components/ProjectLeadsEditor.tsx` (client)

**Interfaces:**
- Consumes B3 actions + `getProjectLeads`; reuses `Combobox`.

- [ ] **Step 1:** On the admin project detail page, fetch `getProjectLeads(projectId)` and render `ProjectLeadsEditor` above/beside the existing members editor.
- [ ] **Step 2:** `ProjectLeadsEditor`: shows primary lead (badge) + co-leads; add a lead (`Combobox`) → `addProjectLead`; remove a co-lead → `removeProjectLead` (disabled/hidden for the primary, with a tooltip "Set another primary first"); "Make primary" on a co-lead → `setPrimaryLead`. `router.refresh()` after each; surface `ActionResult.error` via toast.
- [ ] **Step 3: Verify** `npx tsc --noEmit && npm run lint && npx vitest run` green.
- [ ] **Step 4: Commit** `feat(leads): project-lead management UI on admin project page`

## Self-Review notes
- Coverage: B1 team CRUD, B2 members+project-assign, B3 leads (all actions recompute + audit + auth); B4 teams UI + nav; B5 lead UI. All Phase-B spec items.
- Auth: team CRUD/project-assign/leads = `requireAdmin`; member add/remove = `requireTeamManage`. Consistent everywhere.
- Recompute is called by every membership-affecting action → effective `ProjectMembership` stays correct; `permissions.ts` unchanged.
- Primary-lead-never-empty guard in B3 (remove refuses primary; setPrimaryLead ensures a ProjectLead row).
