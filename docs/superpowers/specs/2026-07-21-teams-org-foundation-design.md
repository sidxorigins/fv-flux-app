# Design — Teams / Org Foundation + Manager Dashboard (Features #4, #6, #7, #5)

Date: 2026-07-21
Branch: `feat/teams-org-foundation`
Source: Flux_Proposed_New_Features.docx #4 (Teams), #6 (Manager & Team Structure), #7 (Project Lead Management), #5 (Manager Dashboard).

Introduces the organisational layer — **Teams**, **multiple Project Leads**, and a
**Manager Dashboard** — on top of the existing two-tier authz (global `ADMIN`/`USER` +
per-project `ProjectMembership` role). Org shape: **Admin → Manager → Team → Members →
Projects → Tasks**, where a team works across many projects and a person can be on many
teams/projects.

---

## Locked decisions (from brainstorming)
1. **Teams provision memberships (hybrid).** Assigning a team to a project materialises
   `ProjectMembership` rows for its members. `ProjectMembership` stays the single source of
   truth `lib/permissions.ts` reads — permission code is **unchanged**.
2. **Team→project role is configurable per assignment** (`TeamProject.role`). Regular members
   get that role on that project; the **team manager gets `MANAGER`** on all the team's projects
   (so delegation works regardless of the members' configured role).
3. **Team management: Admin does CRUD; the assigned team manager may add/remove members of
   their own team.** (`canManageTeam` = admin || `team.managerId === me`.)
4. **Project Leads: multiple, built now.** Keep existing required `Project.leadId` as the
   *primary* lead; add a `ProjectLead` join for co-leads. A lead gets `MANAGER` on their own
   project(s) — "manage without full admin." Backfill existing `leadId` into `ProjectLead`.
5. **Manager Dashboard built now** (`/manager`), scoped to the manager's teams/projects, and it
   MUST include a **per-member complete list of active (non-DONE) tasks**.
6. **`Task.estimatedHours Float?` pulled forward** (a one-field slice of #10) so the dashboard's
   estimated / remaining / over-estimate hour KPIs are real. Full task timeline (start/end dates,
   #10) stays deferred.

## Non-goals (this spec)
- Per-role *configurable permission matrix* (#9) — leads/managers get fixed sensible scopes.
- Full task timeline / start-end dates (#10 beyond `estimatedHours`), automatic pause-resume timer
  semantics (#11), productivity *trends over time* charts beyond what's cheap. "Team activity" =
  reuse existing ActivityLog. Team member **self-view of peers** (#8) is a separate later spec.
- No change to how `permissions.ts` resolves access (it keeps reading `ProjectMembership`).

---

## Data model (Prisma migration — additive except backfill)

```prisma
model Team {
  id          String   @id @default(cuid())
  name        String
  description String?
  isActive    Boolean  @default(true)
  managerId   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  manager  User?            @relation("TeamManager", fields: [managerId], references: [id], onDelete: SetNull)
  members  TeamMembership[]
  projects TeamProject[]
  @@index([managerId])
}

model TeamMembership {
  id        String   @id @default(cuid())
  teamId    String
  userId    String
  createdAt DateTime @default(now())
  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([teamId, userId])
  @@index([userId])
}

model TeamProject {
  id        String      @id @default(cuid())
  teamId    String
  projectId String
  role      ProjectRole @default(MEMBER) // role granted to team MEMBERS on this project
  createdAt DateTime    @default(now())
  team    Team    @relation(fields: [teamId], references: [id], onDelete: Cascade)
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([teamId, projectId])
  @@index([projectId])
}

model ProjectLead {
  id        String   @id @default(cuid())
  projectId String
  userId    String
  createdAt DateTime @default(now())
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([projectId, userId])
  @@index([userId])
}
```
Changes to existing models:
- `ProjectMembership` gains **`manualRole ProjectRole?`** (nullable). `projectRole` remains the
  **effective** (max) role read by permissions; `manualRole` = the admin-granted role, or `null`
  when access is purely team/lead-derived. Backfill: for every existing row, `manualRole = projectRole`
  (all current memberships are manual grants).
- `Task` gains **`estimatedHours Float?`** (nullable; hours as a decimal, e.g. `2.5`).
- Add back-relations on `User` (`managedTeams`, `teamMemberships`, `projectLeads`) and `Project`
  (`teams TeamProject[]`, `additionalLeads ProjectLead[]`).
- `Project.leadId` unchanged (still required, primary lead). Migration backfills a `ProjectLead`
  row for each project's current `leadId` so `ProjectLead` is the full lead set.

## Access-sync engine — `lib/access-sync.ts`

Single authority that materialises effective memberships. Pure-ish (takes a Prisma tx client).

```ts
// Effective sources of access for (projectId, userId):
//  - manualRole (if the ProjectMembership row has one)
//  - TeamProject.role for each team assigned to the project the user is a MEMBER of
//  - MANAGER if the user is the manager of any team assigned to the project
//  - MANAGER if the user is a lead of the project (leadId === user OR a ProjectLead row)
export async function recomputeMembership(tx, projectId: string, userId: string): Promise<void>
// gathers sources → if none: delete the ProjectMembership row (if any);
// else: upsert { projectRole: maxRole(sources), manualRole } (manualRole preserved).

export async function recomputeForTeam(tx, teamId: string): Promise<void>   // all (member|manager)×project pairs
export async function recomputeForProject(tx, projectId: string): Promise<void>
export function maxRole(roles: ProjectRole[]): ProjectRole  // by PROJECT_ROLE_ORDER (VIEWER<MEMBER<MANAGER)
```

**Triggers** — every mutation runs the relevant recompute inside its own `$transaction`, then writes
an `AuditLog` entry:
| Mutation | Recompute scope |
|---|---|
| assign team↔project / unassign / change `TeamProject.role` | that team's members+manager × that project |
| add/remove team member | that user × all the team's projects |
| change team manager | old + new manager × all the team's projects |
| add/remove project lead / change primary lead | that user × that project |
| admin grant/revoke **manual** membership (existing action, refactored) | set/clear `manualRole`, that user × project |

Result: `permissions.ts` keeps reading `ProjectMembership.projectRole` with zero changes; correctness
of overlap (manual + team + lead) is guaranteed by recompute using `manualRole` as the manual source.

**Existing membership action refactor:** today's admin "add member / change role / remove member"
writes `ProjectMembership` directly. Refactor it to set/clear `manualRole` then call
`recomputeMembership` — so a manual grant survives team changes and vice-versa. This is the one
existing code path that changes (its external behaviour is preserved; a manual grant still grants).

## Permissions additions — `lib/permissions.ts`

Add (do not change existing resolvers):
- `canManageTeam(userId, teamId)` → `isAdmin || team.managerId === userId`.
- `requireTeamManage(teamId)` server guard (throws `AuthorizationError`).
- `isManagerOfAnyTeam(userId)` and `managedTeamIds(userId)` → gate `/manager`.
- `canManageProjectLeads(userId, projectId)` → admin only (assigning leads is an admin action per #7).
- Global Admin continues to bypass project checks by existing policy.

## UI

### Admin Teams module — `/admin/teams` (+ `/admin/teams/[teamId]`)
- **List:** name, manager, #members, #projects, active/inactive badge, search. "New team" (admin).
- **Detail / edit:** rename, description, activate/deactivate; **assign manager** (user picker);
  **members** add/remove (admin, or the team's manager for their own team); **projects** —
  assign a project with a role select (`VIEWER`/`MEMBER`/`MANAGER`), change role, unassign; read-only
  list of the team's projects with each project's leads shown.
- Every mutation: Zod + server authz (`requireAdmin` or `requireTeamManage`) + recompute + `AuditLog`.
- Add "Teams" to the admin nav. Re-theme to tokens/glass (no default shadcn styling).

### Project Lead management
- Surface on the project settings area **and** in the admin project-access screen: show primary lead +
  co-leads; **assign** (add co-lead), **replace** primary, **remove** co-lead. Admin-gated.
- On change → recompute (lead → `MANAGER` on the project) + `AuditLog`.

### Manager Dashboard — `/manager` (guarded: manager of ≥1 team, or admin)
Server Components fetch aggregates; scoped to `managedTeamIds(me)` and those teams' projects
(admin may pick/scope all). Fast first paint, minimal client JS (CLAUDE.md dashboard rules).
- **KPI row** (glass cards): total assigned · completed · pending · in-progress · overdue ·
  completed on-time vs after due · estimated hrs · actual hrs (Σ TimeEntry) · remaining hrs
  (`Σ estimated − Σ actual`, floored at 0) · tasks over estimate.
- **Workload by member** — bar/list: active-task count + actual hours per member.
- **Per-member active-task list** (the explicit ask) — for every team member, the complete list of
  their non-DONE tasks across the manager's projects: task key, title, project, status, priority,
  due date, estimated/actual hours. Grouped by user, each group collapsible; empty → "No active tasks."
- **Project progress** — done/total per project (progress bar).
- **Team activity** — recent `ActivityLog` across the manager's projects.
- Aggregate with grouped DB queries (`groupBy`/counts), never by loading all tasks into memory.
  At most one quick after-paint fade (respects `prefers-reduced-motion`); no per-card stagger.

## Security
- Team CRUD `requireAdmin`; member edits `requireTeamManage`; lead assignment admin-only; dashboard
  gated to the manager's own teams/projects (a manager cannot read another manager's team data).
- All inputs Zod-validated at the boundary; roles never trusted from the client; no raw SQL.
- `AuditLog` for team create/edit/activate, member add/remove, manager assign, team↔project changes,
  lead assign/replace/remove, and manual-membership grants/revokes.
- Prevent orphaned/duplicate access: recompute is the only writer of team/lead-derived membership
  rows; `@@unique` constraints on all joins.

## Tests (the parts most likely to break silently)
- `maxRole` ordering; `recomputeMembership`: manual-only, team-only, lead-only, and **overlap**
  (manual MEMBER + team MANAGER → effective MANAGER; remove team → downgrades to MEMBER, not deleted;
  remove manual with a team still assigned → stays team role, row not deleted; no source → row deleted).
- Trigger correctness: adding a member to a team assigned to P grants P; removing them revokes P
  (unless another team/manual grants it). Changing `TeamProject.role` updates effective role.
- Lead add → MANAGER on project; remove co-lead → downgrades; primary lead can't be left empty.
- `canManageTeam` / `requireTeamManage`; dashboard scoping (manager sees only own teams/projects).
- Dashboard aggregates: counts match a seeded fixture; per-member active-task list excludes DONE.

## Build phases (sequential; one branch)
- **Phase A — data model + access-sync engine.** Schema migration (+ backfill), `lib/access-sync.ts`,
  permissions additions, refactor the existing membership action through recompute, `Task.estimatedHours`
  + drawer edit. Full unit tests. *(migration)*
- **Phase B — admin Teams module + Project Lead UI.** Server actions (CRUD, member/project/lead
  mutations, all through recompute + audit) + the `/admin/teams` UI + lead management UI + nav. → deploy.
- **Phase C — Manager Dashboard.** Aggregate queries + `/manager` page (KPIs, workload, per-member
  active tasks, project progress, activity) + guard. → deploy.
