# Team Productivity Visibility (#8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A per-team on/off switch that lets members see teammates' productivity on a new `/team` view, hard-gated on the server.

**Architecture:** `Team.membersCanSeeProductivity` flag (default off) + `setTeamProductivityVisibility` action (`requireTeamManage`) + `features/team/queries.ts` (visible-teams resolution + per-teammate aggregates, gated) + `/team` page + toggle UI on `/manager` and `/admin/teams/[teamId]` + a conditional nav link.

**Tech Stack:** Next.js 16 App Router, Prisma, TypeScript strict, Tailwind tokens/glass, Vitest.

## Global Constraints
- Migrations only (`prisma migrate dev`); inspect SQL for a stray TimeEntry partial-index DROP and delete it (memory `timeentry-partial-index`).
- No `any`. Named exports. Default the flag OFF (privacy). `getTeamProductivity` MUST re-check access on the server every call.
- Reuse: `requireTeamManage`/`requireUser`/`AuthorizationError` (`@/lib/permissions`), the manager aggregate style in `src/features/manager/queries.ts`, `StatusBadge` (`@/features/tasks/components`), `Combobox`/`Switch` primitives. Availability = a `TimeEntry` with `endedAt: null`.
- Aggregate with grouped queries; guard empty scope (no `{ in: [] }` that matches all).

---

### Task 1: Migration + `setTeamProductivityVisibility` action

**Files:**
- Modify: `prisma/schema.prisma` (add `membersCanSeeProductivity Boolean @default(false)` to `Team`)
- Migration: `prisma/migrations/*_team_productivity_visibility/`
- Modify: `src/features/admin/schemas.ts` (`teamVisibilitySchema`), `src/features/admin/actions.ts` (action)
- Test: `src/features/admin/actions.test.ts` (append)

- [ ] **Step 1: Schema** — add `membersCanSeeProductivity Boolean @default(false)` to `Team`.
- [ ] **Step 2: Migrate** — `npx prisma migrate dev --name team_productivity_visibility`; inspect SQL (additive `ALTER TABLE Team ADD COLUMN`; delete any TimeEntry DROP INDEX line).
- [ ] **Step 3: Schema (Zod)** — in `schemas.ts`: `export const teamVisibilitySchema = z.object({ teamId: z.string().min(1), visible: z.boolean() });`
- [ ] **Step 4: Action** — in `actions.ts`, mirroring `assignTeamManager` but gated by `requireTeamManage`:
```ts
export async function setTeamProductivityVisibility(input: unknown): Promise<ActionResult> {
  try {
    const parsed = teamVisibilitySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input" };
    const { teamId, visible } = parsed.data;
    const actor = await requireTeamManage(teamId); // admin OR the team's manager
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) return { ok: false, error: "Team not found." };
    await prisma.$transaction(async (tx) => {
      await tx.team.update({ where: { id: teamId }, data: { membersCanSeeProductivity: visible } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "team.productivity_visibility_changed",
          targetType: "Team",
          targetId: teamId,
          metadata: { teamId, visible },
        },
      });
    });
    revalidatePath("/team");
    revalidatePath("/manager");
    revalidatePath(`/admin/teams/${teamId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}
```
Import `teamVisibilitySchema`; `requireTeamManage` is already imported (Phase B).
- [ ] **Step 5: Test** — append: requireTeamManage enforced (non-manager → ok:false); flag written; audit `team.productivity_visibility_changed`. Mirror the existing team-action test mock style (`db.team` present; `requireTeamManage` mocked).
- [ ] **Step 6: Verify + commit** — `npx tsc --noEmit && npx vitest run src/features/admin/actions.test.ts`; commit `feat(team): membersCanSeeProductivity flag + setTeamProductivityVisibility action`.

---

### Task 2: `features/team/` queries + shape helper

**Files:**
- Create: `src/features/team/shape.ts`, `src/features/team/shape.test.ts`, `src/features/team/queries.ts`

**Interfaces:**
- `completionPct(done: number, total: number): number`
- `getVisibleTeams(): Promise<{ id: string; name: string }[]>`
- `getTeamProductivity(teamId: string): Promise<TeamProductivity>` where `TeamProductivity = { teamId, teamName, members: MemberProductivity[] }` and `MemberProductivity = { userId, name, username, counts: {todo,inProgress,inReview,done,overdue}, total, completionPct, estimatedHours, actualHours, activeCount, availability: "working"|"idle" }`.

- [ ] **Step 1: shape.test.ts** — `completionPct(0,0)===0`, `completionPct(3,4)===75`, rounds to integer.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: shape.ts**
```ts
export function completionPct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}
```
- [ ] **Step 4: Run — pass.**
- [ ] **Step 5: queries.ts** (mirror `src/features/manager/queries.ts` style — read it first):
  - `getVisibleTeams()`: `const me = await requireUser()`. If admin → all active teams `{id,name}`. Else: teams where (`members: { some: { userId: me.id } }` AND `membersCanSeeProductivity: true` AND `isActive: true`) OR (`managerId: me.id` AND `isActive: true`). Dedup. Return `{id,name}`.
  - `getTeamProductivity(teamId)`: `const me = await requireUser()`. Load the team `{ id, name, isActive, managerId, membersCanSeeProductivity, members: {userId}, projects: {projectId} }`. GATE: allow iff `me.globalRole === "ADMIN"` OR `team.managerId === me.id` OR (`team.members` includes `me.id` AND `team.membersCanSeeProductivity`); else `throw new AuthorizationError("FORBIDDEN")`. Then compute per member (memberIds = team members + manager) over `projectId in team.projects`:
    - counts by status: `prisma.task.groupBy({ by: ["assigneeId","status"], where: { projectId: { in: projectIds }, assigneeId: { in: memberIds } }, _count: { _all: true } })`; overdue = a separate count (`status != DONE, dueDate < now`) grouped by assignee.
    - hours: `prisma.timeEntry.groupBy({ by:["userId"], where:{ userId:{in:memberIds}, task:{projectId:{in:projectIds}} }, _sum:{minutes:true} })` → /60. estimated: `prisma.task.groupBy({ by:["assigneeId"], where:{...}, _sum:{estimatedHours:true} })`.
    - availability: `prisma.timeEntry.findMany({ where: { userId: { in: memberIds }, endedAt: null }, select: { userId: true } })` → Set of "working".
    - Shape per member; `completionPct(done, total)`. Members with zero tasks still render (empty counts).
  - GUARD empty projectIds → members with zeroed stats (no `in: []` query).
- [ ] **Step 6: tsc + commit** — `npx tsc --noEmit && npx vitest run src/features/team/shape.test.ts`; commit `feat(team): visible-teams + per-teammate productivity queries`.

*(Query gate is unit-tested via the action/permission tests; the aggregate queries follow the untested manager/dashboard query pattern — only `shape.ts` gets unit tests, per repo convention.)*

---

### Task 3: `/team` page + teammate cards + toggle UI + nav

**Files:**
- Create: `src/app/(dashboard)/team/page.tsx`, `src/features/team/components/TeammateCard.tsx`, `TeamProductivitySection.tsx`
- Modify: `src/features/manager/components/ManagerTeamMembers.tsx` (add the toggle), `src/features/admin/components/TeamDetailEditor.tsx` (add the toggle), `src/components/shell/NavLinks.tsx` + shell layout (conditional "Team" link)

- [ ] **Step 1: `/team` page** (RSC) — `getVisibleTeams()`; empty → friendly empty state. Else render a `TeamProductivitySection` per team (each calls `getTeamProductivity(team.id)`), a responsive grid of `TeammateCard`s.
- [ ] **Step 2: `TeammateCard`** — name + username, availability dot ("Working" = success dot, "Idle" = muted), status chips (todo/in-progress/in-review/done + overdue in danger), completion % (progress bar), est/actual hrs, active count. Tokens/glass; transform/opacity only.
- [ ] **Step 3: Toggle in manager + admin** — a `Switch` "Members can see each other's productivity" wired to `setTeamProductivityVisibility({ teamId, visible })` (client, `router.refresh()` + toast on error). Add to `ManagerTeamMembers` (per team) and `TeamDetailEditor`. Read the current value from the team data each already has (thread `membersCanSeeProductivity` into their props/queries if missing).
- [ ] **Step 4: Nav** — shell computes `showTeam = (await getVisibleTeams()).length > 0` (or reuse a lighter count) and passes to `NavLinks`; add `{ href: "/team", label: "Team" }` shown only when `showTeam`. Don't show to users with no visible team.
- [ ] **Step 5: Verify + commit** — `npx tsc --noEmit && npm run lint && npx vitest run && npm run build` (all green, `/team` registered); commit `feat(team): /team productivity view + visibility toggle + nav`.

## Self-Review notes
- Coverage: flag+action (T1), gated queries+shape (T2), page+cards+toggle+nav (T3).
- `getTeamProductivity` re-gates on the server (member+on / manager / admin) — the security core.
- Default off; toggle audited + `requireTeamManage`. Availability from running timer, no new field.
- Grouped aggregates only; empty-scope guarded.
