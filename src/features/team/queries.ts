// Team-productivity read queries. Server-only (DB + session), consumed by the
// gated `/team` view (Team Productivity Visibility #8) — permission failures
// THROW to the nearest error boundary, matching the convention in
// features/manager|dashboard|tasks/queries.ts.
//
// VISIBILITY MODEL: a team's productivity is visible to (1) a global Admin,
// (2) the team's own manager, and (3) a team member ONLY when
// `Team.membersCanSeeProductivity` is on. The flag defaults off (privacy) —
// see the Team model + `setTeamProductivityVisibility`
// (features/admin/actions.ts). getTeamProductivity RE-CHECKS this gate from
// the DB on EVERY call — it never trusts a cached/previous check, since the
// flag (or the caller's membership) can change between page loads.
//
// getVisibleTeams() resolves "which teams can I even open a productivity
// view for" (the /team picker); getTeamProductivity(teamId) resolves the
// actual per-teammate data for one team, gated independently and again.
//
// EFFICIENCY: aggregates come from groupBy/findMany with narrow selects — no
// full task rows are loaded, mirroring features/manager/queries.ts.
//
// EMPTY-SCOPE GUARD: getTeamProductivity skips the task/time-entry aggregate
// queries entirely when the team has no projects — returning zeroed
// per-member stats WITHOUT ever running a Prisma `{ in: [] }` task query.
// Availability (running-timer lookup) is NOT scoped to the team's projects
// (a running timer on any task still counts as "working"), so it's fetched
// unconditionally alongside the member list.

import { prisma } from "@/lib/db";
import { requireUser, AuthorizationError } from "@/lib/permissions";
import { completionPct } from "./shape";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";

/** Round to 1 decimal place — hours are always returned at this precision
 * (matches features/manager/queries.ts#round1). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visible teams
// ─────────────────────────────────────────────────────────────────────────────

export interface VisibleTeam {
  id: string;
  name: string;
}

/**
 * Every active team the session user may open a productivity view for: for a
 * global Admin, every active team; otherwise, teams they manage OR teams
 * they belong to with `membersCanSeeProductivity` on. A single query with an
 * `OR` (rather than two queries unioned in memory) so Prisma naturally
 * dedupes — a team that matches both branches (e.g. a manager who's also
 * listed as a member) still comes back as one row.
 */
export async function getVisibleTeams(): Promise<VisibleTeam[]> {
  const me = await requireUser();

  if (me.globalRole === "ADMIN") {
    return prisma.team.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  return prisma.team.findMany({
    where: {
      isActive: true,
      OR: [
        { managerId: me.id },
        { members: { some: { userId: me.id } }, membersCanSeeProductivity: true },
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-teammate productivity
// ─────────────────────────────────────────────────────────────────────────────

export interface MemberProductivityCounts {
  todo: number;
  inProgress: number;
  inReview: number;
  done: number;
  /** Non-DONE tasks whose dueDate is in the past. Not part of `total` — it's
   * a status cutting across todo/inProgress/inReview, not a fifth bucket. */
  overdue: number;
}

export interface MemberProductivity {
  userId: string;
  name: string;
  username: string;
  counts: MemberProductivityCounts;
  /** todo + inProgress + inReview + done. */
  total: number;
  completionPct: number;
  estimatedHours: number;
  actualHours: number;
  /** Non-DONE tasks assigned to this member (todo + inProgress + inReview). */
  activeCount: number;
  availability: "working" | "idle";
}

export interface TeamProductivity {
  teamId: string;
  teamName: string;
  members: MemberProductivity[];
}

const TEAM_GATE_SELECT = {
  id: true,
  name: true,
  isActive: true,
  managerId: true,
  membersCanSeeProductivity: true,
  members: { select: { userId: true } },
  projects: { select: { projectId: true } },
} as const;

function emptyStatusCounts(): Omit<MemberProductivityCounts, "overdue"> {
  return { todo: 0, inProgress: 0, inReview: 0, done: 0 };
}

// Narrow row shapes for the conditionally-run aggregate queries below —
// structurally satisfied by the real Prisma groupBy results, but declared
// locally so the empty-projectIds branch can assign plain `[]` literals
// without fighting Prisma's generic overload inference.
interface StatusCountRow {
  assigneeId: string | null;
  status: TaskStatus;
  _count: { _all: number };
}
interface AssigneeCountRow {
  assigneeId: string | null;
  _count: { _all: number };
}
interface AssigneeHoursRow {
  assigneeId: string | null;
  _sum: { estimatedHours: number | null };
}
interface UserMinutesRow {
  userId: string;
  _sum: { minutes: number | null };
}

/**
 * Per-teammate productivity for one team — GATED, re-checked from the DB on
 * every call. Allowed iff the caller is a global Admin, the team's own
 * manager, or a team member with `membersCanSeeProductivity` on. Throws
 * `AuthorizationError("FORBIDDEN")` otherwise — including when the team
 * doesn't exist, so a non-member can't distinguish "no access" from "no such
 * team".
 *
 * The team (gate fields + member/project ids) loads in one query. `memberIds`
 * = team members ∪ manager (deduped), so a manager who assigns themself work
 * still shows up. Members with zero tasks still appear, with zeroed counts —
 * matching `getManagerActiveTasksByMember`'s convention in
 * features/manager/queries.ts.
 */
export async function getTeamProductivity(teamId: string): Promise<TeamProductivity> {
  const me = await requireUser();

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: TEAM_GATE_SELECT,
  });
  if (!team) throw new AuthorizationError("FORBIDDEN");

  const isMember = team.members.some((m) => m.userId === me.id);
  const allowed =
    me.globalRole === "ADMIN" ||
    team.managerId === me.id ||
    (isMember && team.membersCanSeeProductivity);
  if (!allowed) throw new AuthorizationError("FORBIDDEN");

  const memberIdSet = new Set(team.members.map((m) => m.userId));
  if (team.managerId) memberIdSet.add(team.managerId);
  const memberIds = [...memberIdSet];

  if (memberIds.length === 0) {
    return { teamId: team.id, teamName: team.name, members: [] };
  }

  const projectIds = team.projects.map((p) => p.projectId);

  const [users, running] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: memberIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, username: true },
    }),
    prisma.timeEntry.findMany({
      where: { userId: { in: memberIds }, endedAt: null },
      select: { userId: true },
    }),
  ]);

  let byStatus: StatusCountRow[] = [];
  let overdueByAssignee: AssigneeCountRow[] = [];
  let estimatedByAssignee: AssigneeHoursRow[] = [];
  let actualByUser: UserMinutesRow[] = [];

  if (projectIds.length > 0) {
    const now = new Date();
    const taskScope: Prisma.TaskWhereInput = {
      projectId: { in: projectIds },
      assigneeId: { in: memberIds },
    };

    [byStatus, overdueByAssignee, estimatedByAssignee, actualByUser] = await Promise.all([
      prisma.task.groupBy({
        by: ["assigneeId", "status"],
        where: taskScope,
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["assigneeId"],
        where: { ...taskScope, status: { not: "DONE" }, dueDate: { lt: now } },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["assigneeId"],
        where: { ...taskScope, estimatedHours: { not: null } },
        _sum: { estimatedHours: true },
      }),
      prisma.timeEntry.groupBy({
        by: ["userId"],
        where: {
          userId: { in: memberIds },
          task: { projectId: { in: projectIds } },
          minutes: { not: null },
        },
        _sum: { minutes: true },
      }),
    ]);
  }

  const countsByAssignee = new Map<string, Omit<MemberProductivityCounts, "overdue">>();
  for (const g of byStatus) {
    if (!g.assigneeId) continue;
    const cur = countsByAssignee.get(g.assigneeId) ?? emptyStatusCounts();
    if (g.status === "TODO") cur.todo += g._count._all;
    else if (g.status === "IN_PROGRESS") cur.inProgress += g._count._all;
    else if (g.status === "IN_REVIEW") cur.inReview += g._count._all;
    else if (g.status === "DONE") cur.done += g._count._all;
    countsByAssignee.set(g.assigneeId, cur);
  }

  const overdueByAssigneeMap = new Map<string, number>();
  for (const g of overdueByAssignee) {
    if (!g.assigneeId) continue;
    overdueByAssigneeMap.set(g.assigneeId, g._count._all);
  }

  const estimatedByAssigneeMap = new Map<string, number>();
  for (const g of estimatedByAssignee) {
    if (!g.assigneeId) continue;
    estimatedByAssigneeMap.set(g.assigneeId, g._sum.estimatedHours ?? 0);
  }

  const actualByUserMap = new Map(
    actualByUser.map((g) => [g.userId, (g._sum.minutes ?? 0) / 60]),
  );

  const workingSet = new Set(running.map((r) => r.userId));

  const members: MemberProductivity[] = users.map((u) => {
    const statusCounts = countsByAssignee.get(u.id) ?? emptyStatusCounts();
    const overdue = overdueByAssigneeMap.get(u.id) ?? 0;
    const total = statusCounts.todo + statusCounts.inProgress + statusCounts.inReview + statusCounts.done;

    return {
      userId: u.id,
      name: u.name,
      username: u.username,
      counts: { ...statusCounts, overdue },
      total,
      completionPct: completionPct(statusCounts.done, total),
      estimatedHours: round1(estimatedByAssigneeMap.get(u.id) ?? 0),
      actualHours: round1(actualByUserMap.get(u.id) ?? 0),
      activeCount: statusCounts.todo + statusCounts.inProgress + statusCounts.inReview,
      availability: workingSet.has(u.id) ? "working" : "idle",
    };
  });

  return { teamId: team.id, teamName: team.name, members };
}
