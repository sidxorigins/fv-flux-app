# Design — Team Productivity Visibility (Feature #8)

Date: 2026-07-21
Branch: `feat/team-productivity`
Source: Flux_Proposed_New_Features.docx #8.

Let team **members** see each other's productivity within a team — gated by a
per-team on/off switch that a manager/admin controls. Read-only work stats only.

## Locked decisions
- **Per-team on/off toggle** — `Team.membersCanSeeProductivity Boolean @default(false)`
  (default OFF; privacy-safe). A manager (or admin) flips it.
- **New `/team` view** — regular members see teammate productivity cards for their
  visible teams (separate from `/manager`).
- **Availability** derived from a running timer (a `TimeEntry` with `endedAt: null` →
  "Working", else "Idle") — no new field.
- Teammate stats are scoped to the **team's projects** (via `TeamProject`) — a member's
  productivity is shown in the context of that team's work, not their whole account.

## Non-goals
- Per-field granularity (all-or-nothing per team). Historical trend charts. Cross-team
  leaderboards. Exposing sensitive fields (email, role, salary — none of that; work stats only).

## Data model
- `Team.membersCanSeeProductivity Boolean @default(false)` (additive migration).

## Server (`features/team/`)
- Action `setTeamProductivityVisibility(input: { teamId, visible })` — `requireTeamManage(teamId)`
  (admin or the team's manager) → update the flag → AuditLog `team.productivity_visibility_changed`
  → `revalidatePath("/team")` + `/manager`/`/admin/teams/${teamId}`.
- `queries.ts`:
  - `getVisibleTeams()` → teams the viewer can see productivity for: teams the viewer is a
    **member** of where `membersCanSeeProductivity === true`, PLUS teams the viewer **manages**
    (always), PLUS (admin) all active teams. `{ id, name }[]`. Active teams only.
  - `getTeamProductivity(teamId)` — **hard server gate**: `requireUser()`, then confirm the
    viewer is (a) a member of the team AND the toggle is on, OR (b) the team's manager, OR
    (c) admin — else `AuthorizationError`. Returns per-member cards over the team's project tasks:
    `{ userId, name, username, counts: { todo, inProgress, inReview, done, overdue }, total,
    completionPct, estimatedHours, actualHours, activeCount, availability: "working"|"idle" }`.
    Aggregate with grouped queries (`groupBy(assigneeId,status)` over `task.projectId in teamProjectIds`,
    a TimeEntry group for hours, one running-timer lookup for availability) — never load all tasks.
- `shape.ts`: `completionPct(done, total)` pure helper (0 when total 0).

## UI
- `/team` page (RSC): guard — if `getVisibleTeams()` is empty → friendly empty state
  ("No team has shared productivity with you yet"). Else, a section per visible team with a
  responsive grid of teammate cards (status chips, completion %, est/actual hrs, active count,
  a "Working/Idle" availability dot). Reuse tokens/glass + `StatusBadge`. Fast first paint,
  server-aggregated, no per-card stagger.
- **Toggle control** — a switch "Members can see each other's productivity" in:
  (1) the manager "My teams" section (`ManagerTeamMembers` on `/manager`), and
  (2) admin team detail (`TeamDetailEditor` on `/admin/teams/[teamId]`) — both call
  `setTeamProductivityVisibility`.
- **Nav** — a "Team" link shown only when `getVisibleTeams()` is non-empty (shell computes a
  `showTeam` boolean, like `showManager`).

## Security
- Default OFF. `getTeamProductivity` re-checks membership + toggle on the server every read — a
  member never sees a team they're not on, or one where the toggle is off. The toggle action is
  `requireTeamManage`-gated + audited. Only work stats exposed (no PII).

## Tests
- `completionPct` (0/0→0, 3/4→75). `setTeamProductivityVisibility`: requireTeamManage enforced,
  flag written, audited. `getTeamProductivity` gate: member+on allowed; member+off rejected;
  non-member rejected; manager allowed; admin allowed. `getVisibleTeams` excludes off-toggle
  member teams, includes managed teams.

## Sequencing
1. Migration (`membersCanSeeProductivity`) + `setTeamProductivityVisibility` action + tests.
2. `features/team/queries.ts` (getVisibleTeams + getTeamProductivity, gated) + `shape.ts` + tests.
3. `/team` page + teammate cards + toggle UI (manager + admin) + nav link.
