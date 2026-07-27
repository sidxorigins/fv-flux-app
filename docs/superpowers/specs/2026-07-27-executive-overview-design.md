# Executive Overview — org-wide dashboard + `EXECUTIVE` access type

**Date:** 2026-07-27
**Status:** Approved
**Scope:** New `EXECUTIVE` value on `GlobalRole` (assignable from the admin area), a new `/executive` page rendering an org-wide project overview, role-aware post-login landing, and one admin convenience action ("grant viewer access to all projects"). Also fixes a lockout guard that this enum change would otherwise break.

## Problem

Flux has three landing surfaces today and none of them answer "how is every project doing?":

- `/dashboard` is deliberately **personal** — scoped to the signed-in user's `ProjectMembership` rows, even for Admins ([`features/dashboard/queries.ts`](../../../src/features/dashboard/queries.ts) header). An Admin with no memberships sees an empty page.
- `/manager` is **team-scoped** — gated on `isManagerOfAnyTeam`, showing that manager's teams and their projects.
- `/admin` is **people and access administration**, not delivery status.

A CEO needs the missing fourth surface: every project, at a glance, with the risky things surfaced — and needs it without being made a global Admin, which would hand them user management, invites, API keys, and audit access they should not have.

## Design

### 1. Access type — `EXECUTIVE` global role

```prisma
enum GlobalRole {
  ADMIN
  EXECUTIVE
  USER
}
```

A read-oriented, org-wide **visibility** role. It grants **no mutation rights whatsoever** beyond what the user's own `ProjectMembership` rows already grant — an `EXECUTIVE` with no memberships can write nothing, exactly like a `USER` with no memberships.

**Why this shape.** Every authorisation check in the codebase is written as `globalRole === "ADMIN"`. A third enum value is therefore fail-closed by construction: `EXECUTIVE` falls through every admin check as a non-admin, and through every project check as a normal user. The new capability has to be granted explicitly, in one place, rather than removed in many.

Changes:

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `EXECUTIVE` to `GlobalRole`. Migration via `prisma migrate dev` — additive enum value, no data backfill. |
| [`features/admin/schemas.ts`](../../../src/features/admin/schemas.ts) | `globalRoleSchema` → `z.enum(["ADMIN", "EXECUTIVE", "USER"])`. This one edit propagates to `changeGlobalRoleSchema`, `createUserSchema`, and `sendInviteSchema` (all reuse it), so a user can be *invited* directly as an executive. |
| [`lib/permissions.ts`](../../../src/lib/permissions.ts) | Add `requireExecutive(): Promise<User>` — passes for `EXECUTIVE` or `ADMIN`, throws `AuthorizationError("FORBIDDEN")` otherwise. Admins pass so the view is previewable and testable. No other helper changes. |
| [`proxy.ts`](../../../src/proxy.ts) | Gate `/executive` on `token.globalRole` being `EXECUTIVE` or `ADMIN`; non-matching authenticated users redirect to `/dashboard` (mirrors the existing `/admin` branch). Cheap JWT check only — the page re-checks via `requireExecutive()`. |
| [`components/shell/NavLinks.tsx`](../../../src/components/shell/NavLinks.tsx) + `Sidebar` / `Topbar` / `MobileNav` | New `EXECUTIVE_NAV_ITEM` (`/executive`, label "Overview", icon `Building2`, `tourId: "nav-executive"`), rendered when `globalRole` is `EXECUTIVE` or `ADMIN`. Nav visibility is cosmetic; the server guard is authoritative. |

Auditing needs no work: `changeGlobalRole` already writes `user.role_changed` with `metadata: { from, to }`.

#### Lockout guard fix (required, not optional)

[`features/admin/actions.ts`](../../../src/features/admin/actions.ts) currently guards the last admin with:

```ts
if (target.globalRole === "ADMIN" && role === "USER") { /* count active admins */ }
```

With a third enum value, demoting the last active Admin to `EXECUTIVE` bypasses the guard entirely and locks the organisation out of `/admin` permanently. The condition becomes:

```ts
if (target.globalRole === "ADMIN" && role !== "ADMIN") { /* count active admins */ }
```

Covered by a unit test asserting `ADMIN → EXECUTIVE` on the last active admin is rejected.

### 2. Landing

Executives land on `/executive` after sign-in, without losing access to their personal dashboard.

- [`features/auth/components/LoginForm.tsx`](../../../src/features/auth/components/LoginForm.tsx): default redirect target changes from `/dashboard` to `/`. An explicit, safe `callbackUrl` still wins, unchanged.
- [`app/page.tsx`](../../../src/app/page.tsx): the existing signed-in redirect becomes role-aware via a shared pure helper `defaultLandingPath(globalRole)` — `EXECUTIVE → "/executive"`, everything else → `"/dashboard"`.

The landing page already redirects signed-in users server-side before rendering, so there is no flash of marketing content. `/dashboard` keeps working for executives and stays in the nav — the redirect sets a default, it does not remove a route.

The helper lives in a non-`"use client"` module (`src/lib/landing.ts`) because it is imported by both a Server Component and the client login form — see the `formatDueDate` regression that 500'd `/explore`.

### 3. `/executive` — the Overview page

Server Components throughout, existing glass utility and design tokens, one `DashboardEntrance` fade after paint (no per-card stagger, no count-up). Route: `src/app/(dashboard)/executive/page.tsx`. Top to bottom:

#### A. Org KPI row

Four glass stat cards, org-wide across **all** projects:

| KPI | Definition |
|---|---|
| Open work | Tasks with `status != DONE` |
| Completed this week | Tasks moved to `DONE` since Monday 00:00 |
| Overdue | `dueDate < today` and `status != DONE` |
| In review | `status = IN_REVIEW` |

Each shows a delta versus the equivalent prior-week figure. Beneath the row, a full-width throughput sparkline strip reusing `ThroughputSpark`.

#### B. Needs attention + throughput chart

Two-thirds / one-third row.

**Needs attention** (left) — a ranked, deterministic risk list, capped at 15 rows. Sources, in rank order:

1. Overdue tasks at `URGENT` or `HIGH` priority (most overdue first)
2. Tasks sitting in `IN_REVIEW` for more than 5 days
3. `URGENT` tasks with no assignee
4. Projects with zero `ActivityLog` entries in 14 days and at least one open task

Each row: severity dot (`--danger` / `--warning`), project key chip, task title, age, owner avatar.

**Throughput chart** (right) — created versus completed per week over 8 weeks, area chart on the existing charting setup. Answers "is the org keeping up with what it takes on".

#### C. Project health board

The centrepiece. One card per project, sorted by health (worst first), then by open count.

Card contents: project key + name · lead avatar · completion bar (`done / total`) · open, in-review, overdue counts · activity count last 7 days · 6-week sparkline · health pill.

Health is a **pure function** over pre-aggregated counts, unit-tested, evaluated in order:

```
STALLED   — activity14d == 0 && open > 0
AT_RISK   — overdue > 0 || unassignedUrgent > 0 || completedThisWeek < completedLastWeek
ON_TRACK  — otherwise
```

Pills use the functional tokens: `ON_TRACK` → `--success`, `AT_RISK` → `--warning`, `STALLED` → `--muted-foreground`. Orange stays reserved for accents and CTAs.

#### D. People and workload

Org-wide open tasks per assignee, top 10, horizontal bars with the overdue portion rendered in `--danger`. Avatar, name, count. Reuses the existing `WorkloadBars` treatment.

#### Data layer

New `src/features/executive/queries.ts`, following the conventions in `features/dashboard/queries.ts`:

- A single `getExecutiveScope()` resolves the user via `requireExecutive()` **once**; every query takes the scope so `Promise.all` does not re-authorise six times. Each query still resolves its own scope when called standalone.
- Aggregates come exclusively from `groupBy` / `count` / narrow selects. No query loads full task rows.
- The only row-level read is the attention list, which is narrow-selected and capped at 15.
- Health inputs (per-project counts, activity windows, weekly completion) are computed in a small number of grouped queries keyed by `projectId`, then zipped in memory — not N queries per project.

Every query calls `requireExecutive()`, so the page cannot leak org-wide data to a plain `USER` even if the route guard were bypassed.

### 4. Drill-down and the visibility trade-off

**Decided:** the Overview aggregates across **all** projects, but drilling into a board or task still requires a real `ProjectMembership` (or global Admin). Consequences, made explicit in the UI:

- Project cards for projects the viewer has no membership in render as **non-links**, with a lock icon and the title "No project access — ask an admin".
- Attention rows behave the same way.

This means the Overview reveals project names, task titles, assignee names, and workload counts for projects the executive cannot open. **That is accepted** for a single-tenant, single-organisation deployment where the viewer is the CEO.

To make the cards actually clickable without hand-adding memberships one at a time, the admin user detail page (`/admin/users/[userId]`) gains one action:

**"Grant viewer access to all projects"** — creates a `VIEWER` `ProjectMembership` for every project the user is not already a member of. Admin-only, Zod-validated, idempotent (skips existing memberships, never downgrades an existing higher role), single transaction, writes one `user.project_access_granted_all` AuditLog entry with the created project ids in `metadata`.

It is a convenience wrapper over the existing membership model, not a new permission concept — the resulting rows are ordinary `VIEWER` memberships, revocable individually through the existing UI.

## Testing

Per CLAUDE.md, tests go where logic can break silently:

- **Permissions** — `requireExecutive` passes `EXECUTIVE` and `ADMIN`, rejects `USER`, rejects `SUSPENDED` executives; an `EXECUTIVE` is refused by `requireAdmin` and by `requireProjectRole` on a project they have no membership in.
- **Lockout guard** — demoting the last active `ADMIN` to `EXECUTIVE` is rejected; demoting a non-last admin succeeds.
- **Health signal** — table-driven cases over the pure function, one per branch plus boundary cases (exactly 0 overdue, exactly 14 days silent).
- **KPI deltas** — week-boundary arithmetic, including a task completed exactly at the boundary.
- **`defaultLandingPath`** — one case per role.
- **e2e (Playwright)** — an `EXECUTIVE` signs in and lands on `/executive`; navigating to `/admin` redirects to `/dashboard`; a project card without membership is not a link.

## Out of scope

Configurable health thresholds, exporting or emailing the overview, a date-range picker, per-project executive scoping (rejected in favour of the global role), and any exec-specific mutation capability.
