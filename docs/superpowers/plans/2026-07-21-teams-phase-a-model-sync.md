# Teams Org Foundation — Phase A: Data Model + Access-Sync Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add the Team/Lead data model + a membership recompute engine so team/lead assignment materialises effective `ProjectMembership` rows, leaving `lib/permissions.ts` resolution unchanged.

**Architecture:** New models `Team`, `TeamMembership`, `TeamProject`, `ProjectLead`; `ProjectMembership.manualRole` (effective `projectRole` stays what permissions reads); `Task.estimatedHours`. A single `lib/access-sync.ts` recomputes a membership row from all justifications (manual + team + lead). The three existing admin membership actions are refactored to write `manualRole` + recompute.

**Tech Stack:** Prisma 7 (`prisma-client` generator → `src/generated/prisma`), PostgreSQL, TypeScript strict, Vitest.

## Global Constraints
- Migrations only — `npx prisma migrate dev --name <n>`; never `db push`. After generating, **inspect the migration SQL**: if it contains a `DROP INDEX` for the TimeEntry one-running-timer partial index, delete that line before committing (that index is hand-authored SQL — see memory `timeentry-partial-index`).
- No `any`. Named exports. `ProjectRole` values: `VIEWER=0 < MEMBER=1 < MANAGER=2` (`PROJECT_ROLE_ORDER` in `src/lib/permissions.ts:24`).
- `manualRole` is the ONLY manual source; recompute is the ONLY writer of effective `projectRole` for derived access. Effective `projectRole = maxRole([manualRole?, ...teamRoles, ...leadRole])`.
- Every membership-affecting mutation recomputes inside a `$transaction`.
- Prisma client is imported from `@/lib/db` (`prisma`). Enums from `@/generated/prisma/enums`.

---

### Task A1: Schema migration + backfill

**Files:**
- Modify: `prisma/schema.prisma`
- Create (generated): `prisma/migrations/<ts>_teams_org_foundation/migration.sql`

**Interfaces:**
- Produces models `Team`, `TeamMembership`, `TeamProject`, `ProjectLead`; `ProjectMembership.manualRole ProjectRole?`; `Task.estimatedHours Float?`; `User` relations `managedTeams`, `teamMemberships`, `projectLeads`; `Project` relations `teams`, `additionalLeads`.

- [ ] **Step 1: Add models + fields to `prisma/schema.prisma`**

Add the four new models (exact fields from the design doc `Data model` section — `Team`, `TeamMembership`, `TeamProject`, `ProjectLead`). Then:
- On `ProjectMembership`, add `manualRole ProjectRole?` (after `projectRole`).
- On `Task`, add `estimatedHours Float?` (near `dueDate`).
- On `User`, add relations:
  ```prisma
  managedTeams    Team[]           @relation("TeamManager")
  teamMemberships TeamMembership[]
  projectLeads    ProjectLead[]
  ```
- On `Project`, add relations:
  ```prisma
  teams           TeamProject[]
  additionalLeads ProjectLead[]
  ```

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name teams_org_foundation --create-only`
Then OPEN the generated `migration.sql`. Verify it only CREATEs the new tables/columns/indexes and does NOT drop the TimeEntry partial index (`*_running_*` / any hand-authored partial unique). If such a `DROP INDEX` line is present, delete it.

- [ ] **Step 3: Append backfill SQL** to the same `migration.sql` (after the generated DDL):

```sql
-- Backfill: existing memberships are all manual grants.
UPDATE "ProjectMembership" SET "manualRole" = "projectRole" WHERE "manualRole" IS NULL;

-- Backfill: each project's current primary lead becomes a ProjectLead row (full lead set).
INSERT INTO "ProjectLead" ("id", "projectId", "userId", "createdAt")
SELECT gen_random_uuid(), "id", "leadId", now() FROM "Project"
ON CONFLICT ("projectId", "userId") DO NOTHING;
```
(If `gen_random_uuid()` is unavailable, use the cuid-style default instead by leaving `id` out and relying on Prisma's `@default(cuid())` — but Prisma cuids are app-side; for raw SQL backfill `gen_random_uuid()` on Postgres 16 is available via `pgcrypto`/built-in. Postgres 16 has `gen_random_uuid()` built-in — use it.)

- [ ] **Step 4: Apply the migration**

Run: `npx prisma migrate dev` (applies + regenerates client).
Expected: migration applies cleanly to `flux_dev`; client regenerated.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (new relations resolve).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(teams): schema — Team/TeamMembership/TeamProject/ProjectLead + manualRole + estimatedHours"
```

---

### Task A2: Access-sync engine (`lib/access-sync.ts`)

**Files:**
- Create: `src/lib/access-sync.ts`
- Test: `src/lib/access-sync.test.ts`

**Interfaces:**
- Consumes: A1 models; `PROJECT_ROLE_ORDER` from `@/lib/permissions`.
- Produces:
  - `maxRole(roles: ProjectRole[]): ProjectRole | null`
  - `recomputeMembership(tx: Tx, projectId: string, userId: string): Promise<void>`
  - `recomputeForTeam(tx: Tx, teamId: string): Promise<void>`
  - `recomputeForProject(tx: Tx, projectId: string): Promise<void>`
  - where `Tx` = `Prisma.TransactionClient` (import type from `@/generated/prisma`).

- [ ] **Step 1: Write failing tests** — `src/lib/access-sync.test.ts`

Unit-test `maxRole` (pure) directly; test `recomputeMembership` against the real `flux_dev` DB (the repo already runs DB-backed tests — follow the existing pattern in e.g. `src/features/**/**.test.ts` that seed rows). Cases:
- `maxRole([])` → `null`; `maxRole(["VIEWER","MANAGER","MEMBER"])` → `"MANAGER"`.
- recompute: manual-only MEMBER → row with `projectRole=MEMBER, manualRole=MEMBER`.
- team-only (member of a team assigned MEMBER) → row `projectRole=MEMBER, manualRole=null`.
- lead-only (ProjectLead row) → `projectRole=MANAGER, manualRole=null`.
- overlap: manual MEMBER + team MANAGER → `projectRole=MANAGER, manualRole=MEMBER`; then remove team → recompute → `projectRole=MEMBER` (row kept, `manualRole=MEMBER`).
- no source → row deleted.
(Use a helper to create Project+User+Team fixtures; clean up in `afterEach`. Mirror the seeding style already used in the admin/tasks tests.)

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/lib/access-sync.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/access-sync.ts`**

```ts
import type { Prisma, ProjectRole } from "@/generated/prisma";
import { PROJECT_ROLE_ORDER } from "@/lib/permissions";

type Tx = Prisma.TransactionClient;

/** Highest role by PROJECT_ROLE_ORDER, or null for an empty list. */
export function maxRole(roles: ProjectRole[]): ProjectRole | null {
  let best: ProjectRole | null = null;
  for (const r of roles) {
    if (best === null || PROJECT_ROLE_ORDER[r] > PROJECT_ROLE_ORDER[best]) best = r;
  }
  return best;
}

/**
 * Recompute the effective ProjectMembership for one (project, user) from all
 * access sources: the row's own manualRole, team-member roles (TeamProject.role
 * for active teams the user is a member of), MANAGER if they manage such a team,
 * and MANAGER if they are a lead of the project. Writes or deletes the row so
 * lib/permissions.ts (which reads projectRole) sees the correct effective role.
 */
export async function recomputeMembership(
  tx: Tx,
  projectId: string,
  userId: string,
): Promise<void> {
  const existing = await tx.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { manualRole: true },
  });

  const sources: ProjectRole[] = [];
  if (existing?.manualRole) sources.push(existing.manualRole);

  // Team assignments for this project where the user is a member (active teams only).
  const teamProjects = await tx.teamProject.findMany({
    where: { projectId, team: { isActive: true } },
    select: { role: true, teamId: true, team: { select: { managerId: true } } },
  });
  if (teamProjects.length > 0) {
    const teamIds = teamProjects.map((t) => t.teamId);
    const memberships = await tx.teamMembership.findMany({
      where: { userId, teamId: { in: teamIds } },
      select: { teamId: true },
    });
    const memberTeamIds = new Set(memberships.map((m) => m.teamId));
    for (const tp of teamProjects) {
      if (memberTeamIds.has(tp.teamId)) sources.push(tp.role);
      if (tp.team.managerId === userId) sources.push("MANAGER");
    }
  }

  // Lead of the project? (primary leadId OR a ProjectLead row.)
  const [project, leadRow] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId }, select: { leadId: true } }),
    tx.projectLead.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    }),
  ]);
  if (project?.leadId === userId || leadRow) sources.push("MANAGER");

  const role = maxRole(sources);
  if (role === null) {
    if (existing) {
      await tx.projectMembership.delete({
        where: { projectId_userId: { projectId, userId } },
      });
    }
    return;
  }
  await tx.projectMembership.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: { projectRole: role },
    create: { projectId, userId, projectRole: role, manualRole: null },
  });
}

/** Recompute every (member|manager) × project pair implied by a team. */
export async function recomputeForTeam(tx: Tx, teamId: string): Promise<void> {
  const team = await tx.team.findUnique({
    where: { id: teamId },
    select: {
      managerId: true,
      members: { select: { userId: true } },
      projects: { select: { projectId: true } },
    },
  });
  if (!team) return;
  const userIds = new Set(team.members.map((m) => m.userId));
  if (team.managerId) userIds.add(team.managerId);
  for (const { projectId } of team.projects) {
    for (const userId of userIds) {
      await recomputeMembership(tx, projectId, userId);
    }
  }
}

/** Recompute every user that could derive access to a project (leads + all teams' people). */
export async function recomputeForProject(tx: Tx, projectId: string): Promise<void> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      leadId: true,
      additionalLeads: { select: { userId: true } },
      teams: {
        select: {
          team: {
            select: { managerId: true, members: { select: { userId: true } } },
          },
        },
      },
      memberships: { select: { userId: true } },
    },
  });
  if (!project) return;
  const userIds = new Set<string>();
  userIds.add(project.leadId);
  project.additionalLeads.forEach((l) => userIds.add(l.userId));
  project.memberships.forEach((m) => userIds.add(m.userId));
  for (const tp of project.teams) {
    if (tp.team.managerId) userIds.add(tp.team.managerId);
    tp.team.members.forEach((m) => userIds.add(m.userId));
  }
  for (const userId of userIds) {
    await recomputeMembership(tx, projectId, userId);
  }
}
```

- [ ] **Step 4: Run tests — pass**

Run: `npx vitest run src/lib/access-sync.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/access-sync.ts src/lib/access-sync.test.ts
git commit -m "feat(teams): access-sync engine — recompute effective membership from manual+team+lead"
```

---

### Task A3: Permissions additions

**Files:**
- Modify: `src/lib/permissions.ts`
- Test: `src/lib/permissions.test.ts` (append; file exists)

**Interfaces:**
- Produces: `canManageTeam(userId, teamId): Promise<boolean>`, `requireTeamManage(teamId): Promise<User>`, `managedTeamIds(userId): Promise<string[]>`, `isManagerOfAnyTeam(userId): Promise<boolean>`, `canManageProjectLeads(userId): boolean` (admin-only — takes the already-resolved user).

- [ ] **Step 1: Write failing tests** — append to `src/lib/permissions.test.ts`

Cases: `canManageTeam` true for admin, true for the team's `managerId`, false otherwise; `managedTeamIds` returns only teams the user manages; `requireTeamManage` throws `AuthorizationError("FORBIDDEN")` for a non-manager non-admin.

- [ ] **Step 2: Run — fail.** `npx vitest run src/lib/permissions.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `src/lib/permissions.ts`:

```ts
export async function canManageTeam(userId: string, teamId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { globalRole: true } });
  if (user?.globalRole === "ADMIN") return true;
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { managerId: true } });
  return !!team && team.managerId === userId;
}

/** Throws AuthorizationError unless the caller is Admin or the team's manager. */
export async function requireTeamManage(teamId: string): Promise<User> {
  const user = await requireUser();
  if (user.globalRole === "ADMIN") return user;
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { managerId: true } });
  if (!team || team.managerId !== user.id) throw new AuthorizationError("FORBIDDEN");
  return user;
}

export async function managedTeamIds(userId: string): Promise<string[]> {
  const teams = await prisma.team.findMany({ where: { managerId: userId }, select: { id: true } });
  return teams.map((t) => t.id);
}

export async function isManagerOfAnyTeam(userId: string): Promise<boolean> {
  const n = await prisma.team.count({ where: { managerId: userId } });
  return n > 0;
}

/** Assigning/removing project leads is an Admin-only action (#7). */
export function canManageProjectLeads(user: User): boolean {
  return user.globalRole === "ADMIN";
}
```
(Use the file's existing `prisma`/`requireUser`/`AuthorizationError`/`User` imports.)

- [ ] **Step 4: Run — pass.** `npx vitest run src/lib/permissions.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "feat(teams): permission helpers — canManageTeam/requireTeamManage/managedTeamIds"
```

---

### Task A4: Refactor the three membership actions through recompute

**Files:**
- Modify: `src/features/admin/actions.ts` (`addProjectMember` ~549, `updateProjectMember` ~590, `removeProjectMember` ~632)
- Test: `src/features/admin/actions.test.ts` (append if exists; else create) — the manual/derived-overlap behaviour.

**Interfaces:**
- Consumes: `recomputeMembership` from `@/lib/access-sync`.

- [ ] **Step 1: Write failing tests** — a manual grant then a team assignment on the same (project,user): removing the manual grant must NOT delete access (team still justifies); the effective role reflects `max`.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Refactor** (preserve external behaviour + audit entries):
- `addProjectMember` / `updateProjectMember`: inside the `$transaction`, set `manualRole` (upsert `create: { projectId, userId, projectRole, manualRole: projectRole }`, `update: { manualRole: projectRole }`), then `await recomputeMembership(tx, projectId, userId)` (which sets the effective `projectRole`). Keep the same audit `action` strings. `updateProjectMember`'s "not a member" guard should check for a row with a non-null `manualRole` (a purely-derived row is not a manual member).
- `removeProjectMember`: inside the `$transaction`, if a row with `manualRole` exists, set `manualRole = null`, then `await recomputeMembership(tx, projectId, userId)` (deletes the row iff nothing else justifies; else downgrades to derived role). Keep audit `membership.revoked`. Stay idempotent.
- Import `recomputeMembership`. Keep `revalidateMembership` calls.

- [ ] **Step 4: Run — pass.** `npx vitest run src/features/admin/actions.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/admin/actions.ts src/features/admin/actions.test.ts
git commit -m "feat(teams): route manual membership grants through recompute (manualRole)"
```

---

### Task A5: `Task.estimatedHours` — validation + edit

**Files:**
- Modify: `src/features/tasks/schemas.ts` (task update Zod schema)
- Modify: `src/features/tasks/actions.ts` (`updateTask` — accept `estimatedHours`)
- Modify: `src/features/tasks/components/TaskDetailPanel.tsx` (drawer — an estimated-hours field near due date)
- Test: `src/features/tasks/*.test.ts` (schema accepts null + positive decimals; rejects negatives)

**Interfaces:**
- Produces: `estimatedHours` on the task update path + drawer editing.

- [ ] **Step 1: Write failing schema test** — `estimatedHours`: accepts `null`, `0.5`, `40`; rejects `-1` and `> 10000`.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement**
- Zod: add `estimatedHours: z.number().min(0).max(10000).nullable().optional()` to the task-update schema.
- `updateTask`: thread `estimatedHours` into the `data` (only when provided), and add an ActivityLog entry when it changes (mirror the existing field-change logging in that action).
- Drawer: add a small numeric input (label "Est. hours") beside the due-date control; `MEMBER`+ can edit (same gate as other task edits); debounce/commit like the existing inline fields. Display "—" when null. Never animate layout.

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Verify whole suite + build**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks
git commit -m "feat(tasks): estimatedHours field — validation, update action, drawer edit"
```

## Self-Review notes
- Coverage: models+backfill (A1), engine+overlap (A2), guards (A3), manual-grant refactor (A4), estimatedHours (A5) — all Phase-A spec items.
- `maxRole`/`recomputeMembership` are the crux — A2 tests cover manual/team/lead/overlap/delete.
- `manualRole` naming consistent across A1/A2/A4. `PROJECT_ROLE_ORDER` reused, not redefined.
- Migration guard for the TimeEntry partial index is called out in A1 step 2.
