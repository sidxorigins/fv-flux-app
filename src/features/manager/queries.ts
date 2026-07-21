// Manager-dashboard read queries. Server-only (DB + session), consumed by the
// /manager Server Component — permission failures THROW to the nearest error
// boundary, matching the convention in features/dashboard|tasks|projects/queries.ts.
//
// SCOPING (deliberate, documented): every query here is scoped to the teams the
// session user MANAGES (`Team.managerId === me`, active teams only) — never to
// their own task assignments, and never to teams they merely belong to as a
// member. A global Admin sees the union of every active team (the same query,
// just without the `managerId` filter) — this keeps the admin case on the exact
// same code path instead of a separate "all projects" query, so admin scope
// stays "every team", not "literally every row in the DB". Callers MUST re-check
// `isManagerOfAnyTeam(me) || admin` at the page/guard level before calling these
// — this module does not gate on "does the caller manage anything", it just
// resolves what they manage (which may be nothing).
//
// EFFICIENCY: aggregates come from groupBy/count/aggregate or narrow selects —
// no query here loads full task rows except getManagerActiveTasksByMember,
// which is explicitly the "complete list" headline and is bounded by the
// manager's own task set (their scoped projects x non-DONE), not the whole DB.
// The page resolves the scope ONCE via getManagerScope() and passes it to each
// query so Promise.all() doesn't re-fetch the session user + team list six times.
//
// EMPTY-SCOPE GUARD: every query short-circuits when `scope.projectIds` is
// empty (a manager whose team(s) have no projects yet, or a fresh manager with
// no teams) — returning zeroed KPIs / empty arrays WITHOUT ever running a
// Prisma `{ in: [] }` query.

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { getAvatarUrl } from "@/features/users/avatar";
import type { DashboardActivity } from "@/features/dashboard/queries";
import { bucketCompletion, isOverEstimate, remainingHours } from "./shape";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";

/** Round to 1 decimal place — hours are always displayed/returned at this precision. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────────────────────────────────────

export interface ManagerScope {
  /** True for a global Admin — widens scope to every active team. */
  isAdmin: boolean;
  teamIds: string[];
  /** Union of TeamProject.projectId across the manager's active teams. */
  projectIds: string[];
  /** Union of TeamMembership.userId across the manager's active teams, plus the manager themself. */
  memberIds: string[];
  teams: { id: string; name: string }[];
}

const TEAM_SCOPE_SELECT = {
  id: true,
  name: true,
  projects: { select: { projectId: true } },
  members: { select: { userId: true } },
} as const;

/**
 * Resolve the session user's managed-team scope in one pass: their active
 * teams (or, for a global Admin, every active team), deduped project + member
 * ids, and the team list for a picker/label. A manager who manages nothing
 * gets an all-empty scope — every downstream query treats that as "show zero
 * / nothing", never "show everything".
 */
export async function getManagerScope(): Promise<ManagerScope> {
  const user = await requireUser();
  const isAdmin = user.globalRole === "ADMIN";

  const teams = await prisma.team.findMany({
    where: isAdmin
      ? { isActive: true }
      : { managerId: user.id, isActive: true },
    select: TEAM_SCOPE_SELECT,
  });

  const projectIds = new Set<string>();
  const memberIds = new Set<string>([user.id]); // the manager always sees their own work
  for (const team of teams) {
    for (const tp of team.projects) projectIds.add(tp.projectId);
    for (const m of team.members) memberIds.add(m.userId);
  }

  return {
    isAdmin,
    teamIds: teams.map((t) => t.id),
    projectIds: [...projectIds],
    memberIds: [...memberIds],
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
  };
}

/** Where-fragment limiting tasks to the scope's managed projects. */
function inScope(scope: ManagerScope): Prisma.TaskWhereInput {
  return { projectId: { in: scope.projectIds } };
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIs
// ─────────────────────────────────────────────────────────────────────────────

export interface ManagerKpis {
  /** Total tasks across the manager's scoped projects. */
  assigned: number;
  done: number;
  todo: number;
  inProgress: number;
  inReview: number;
  /** Non-DONE, dueDate in the past. */
  overdue: number;
  /** Tasks whose latest status→DONE transition landed at/before their due date. */
  completedOnTime: number;
  /** Tasks whose latest status→DONE transition landed after their due date. */
  completedLate: number;
  /** Σ Task.estimatedHours across scoped tasks. */
  estimatedHours: number;
  /** Σ TimeEntry.minutes / 60 across scoped tasks (stopped entries only). */
  actualHours: number;
  /** max(0, estimatedHours − actualHours), floored at 0. */
  remainingHours: number;
  /** Count of tasks where actual hours logged exceed the estimate (both present). */
  overEstimateCount: number;
}

const EMPTY_KPIS: ManagerKpis = {
  assigned: 0,
  done: 0,
  todo: 0,
  inProgress: 0,
  inReview: 0,
  overdue: 0,
  completedOnTime: 0,
  completedLate: 0,
  estimatedHours: 0,
  actualHours: 0,
  remainingHours: 0,
  overEstimateCount: 0,
};

/**
 * The manager KPI row. Five queries, no full task rows:
 *  1. groupBy(status) → assigned total + the four status counts
 *  2. count() → overdue
 *  3. a narrow ActivityLog select (status→DONE transitions) → on-time/late,
 *     bucketed via shape.bucketCompletion after keeping only the LATEST
 *     transition per task (a task bounced out of Done and back counts once,
 *     at its most recent completion).
 *  4. tasks with an estimate (narrow select) → Σ estimatedHours
 *  5. TimeEntry groupBy(taskId) → Σ actualHours + per-task over-estimate check
 */
export async function getManagerKpis(scope: ManagerScope): Promise<ManagerKpis> {
  if (scope.projectIds.length === 0) return EMPTY_KPIS;
  const now = new Date();

  const [byStatus, overdue, doneLogs, estimatedTasks, actualByTask] =
    await Promise.all([
      prisma.task.groupBy({
        by: ["status"],
        where: inScope(scope),
        _count: { _all: true },
      }),
      prisma.task.count({
        where: { ...inScope(scope), status: { not: "DONE" }, dueDate: { lt: now } },
      }),
      prisma.activityLog.findMany({
        where: { field: "status", newValue: "DONE", task: inScope(scope) },
        select: { taskId: true, createdAt: true, task: { select: { dueDate: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.task.findMany({
        where: { ...inScope(scope), estimatedHours: { not: null } },
        select: { id: true, estimatedHours: true },
      }),
      prisma.timeEntry.groupBy({
        by: ["taskId"],
        where: { task: inScope(scope), minutes: { not: null } },
        _sum: { minutes: true },
      }),
    ]);

  const countOf = (status: TaskStatus) =>
    byStatus.find((g) => g.status === status)?._count._all ?? 0;
  const assigned = byStatus.reduce((sum, g) => sum + g._count._all, 0);

  // Latest DONE-transition per task (rows are already ordered desc) → bucket.
  const seen = new Set<string>();
  let completedOnTime = 0;
  let completedLate = 0;
  for (const log of doneLogs) {
    if (seen.has(log.taskId)) continue;
    seen.add(log.taskId);
    const bucket = bucketCompletion(log.task.dueDate, log.createdAt);
    if (bucket === "on_time") completedOnTime++;
    else if (bucket === "late") completedLate++;
  }

  const actualHoursByTask = new Map(
    actualByTask.map((g) => [g.taskId, (g._sum.minutes ?? 0) / 60]),
  );
  let estimatedHoursSum = 0;
  let overEstimateCount = 0;
  for (const t of estimatedTasks) {
    estimatedHoursSum += t.estimatedHours ?? 0;
    const actual = actualHoursByTask.get(t.id) ?? 0;
    if (isOverEstimate(t.estimatedHours, actual)) overEstimateCount++;
  }
  const actualMinutesTotal = actualByTask.reduce(
    (sum, g) => sum + (g._sum.minutes ?? 0),
    0,
  );
  const actualHoursSum = actualMinutesTotal / 60;

  return {
    assigned,
    done: countOf("DONE"),
    todo: countOf("TODO"),
    inProgress: countOf("IN_PROGRESS"),
    inReview: countOf("IN_REVIEW"),
    overdue,
    completedOnTime,
    completedLate,
    estimatedHours: round1(estimatedHoursSum),
    actualHours: round1(actualHoursSum),
    remainingHours: round1(remainingHours(estimatedHoursSum, actualHoursSum)),
    overEstimateCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workload by member
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkloadRow {
  userId: string;
  name: string;
  username: string;
  /** Non-DONE tasks assigned to this member across the manager's scoped projects. */
  activeCount: number;
  actualHours: number;
}

/**
 * Workload per member of the manager's teams — every member appears, even at
 * zero (a manager needs to see who's idle, not just who's busy). Exactly
 * three queries: a groupBy for active-task counts, a groupBy for logged
 * hours, and one user lookup — no task rows.
 */
export async function getManagerWorkload(scope: ManagerScope): Promise<WorkloadRow[]> {
  if (scope.projectIds.length === 0) return [];

  const [byAssignee, byUserMinutes, users] = await Promise.all([
    prisma.task.groupBy({
      by: ["assigneeId"],
      where: {
        ...inScope(scope),
        status: { not: "DONE" },
        assigneeId: { in: scope.memberIds },
      },
      _count: { _all: true },
    }),
    prisma.timeEntry.groupBy({
      by: ["userId"],
      where: {
        task: inScope(scope),
        userId: { in: scope.memberIds },
        minutes: { not: null },
      },
      _sum: { minutes: true },
    }),
    prisma.user.findMany({
      where: { id: { in: scope.memberIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, username: true },
    }),
  ]);

  const activeByUser = new Map(
    byAssignee
      .filter((g): g is typeof g & { assigneeId: string } => g.assigneeId !== null)
      .map((g) => [g.assigneeId, g._count._all]),
  );
  const hoursByUser = new Map(
    byUserMinutes.map((g) => [g.userId, round1((g._sum.minutes ?? 0) / 60)]),
  );

  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    username: u.username,
    activeCount: activeByUser.get(u.id) ?? 0,
    actualHours: hoursByUser.get(u.id) ?? 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Active tasks by member (the headline)
// ─────────────────────────────────────────────────────────────────────────────

export interface ManagerActiveTask {
  id: string;
  key: string;
  title: string;
  projectKey: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  estimatedHours: number | null;
  actualHours: number;
}

export interface MemberActiveTasks {
  userId: string;
  name: string;
  username: string;
  /** This member's complete non-DONE task list across the manager's scoped projects. */
  tasks: ManagerActiveTask[];
}

/**
 * THE headline query: for every member the manager oversees, their complete
 * list of non-DONE tasks. One task query (assigneeId in scope.memberIds,
 * projectId in scope.projectIds, status != DONE, narrow select incl.
 * project.key) + one TimeEntry groupBy(taskId) for actual hours, shaped in
 * memory — bounded by the manager's own task set, not the whole DB. Members
 * with zero active tasks still appear, with an empty `tasks` array.
 */
export async function getManagerActiveTasksByMember(
  scope: ManagerScope,
): Promise<MemberActiveTasks[]> {
  if (scope.projectIds.length === 0) return [];

  const [users, tasks] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: scope.memberIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, username: true },
    }),
    prisma.task.findMany({
      where: {
        ...inScope(scope),
        assigneeId: { in: scope.memberIds },
        status: { not: "DONE" },
      },
      orderBy: [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }],
      select: {
        id: true,
        key: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        estimatedHours: true,
        assigneeId: true,
        project: { select: { key: true } },
      },
    }),
  ]);

  const taskIds = tasks.map((t) => t.id);
  const actualByTask = taskIds.length
    ? await prisma.timeEntry.groupBy({
        by: ["taskId"],
        where: { taskId: { in: taskIds }, minutes: { not: null } },
        _sum: { minutes: true },
      })
    : [];
  const actualHoursByTask = new Map(
    actualByTask.map((g) => [g.taskId, round1((g._sum.minutes ?? 0) / 60)]),
  );

  const tasksByAssignee = new Map<string, ManagerActiveTask[]>();
  for (const t of tasks) {
    if (!t.assigneeId) continue; // filtered to assigneeId in memberIds above; guards TS null
    const list = tasksByAssignee.get(t.assigneeId) ?? [];
    list.push({
      id: t.id,
      key: t.key,
      title: t.title,
      projectKey: t.project.key,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      estimatedHours: t.estimatedHours,
      actualHours: actualHoursByTask.get(t.id) ?? 0,
    });
    tasksByAssignee.set(t.assigneeId, list);
  }

  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    username: u.username,
    tasks: tasksByAssignee.get(u.id) ?? [],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Project progress
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectProgress {
  projectId: string;
  key: string;
  name: string;
  total: number;
  done: number;
}

/**
 * Task totals per scoped project — one groupBy({by:[projectId,status]}) plus
 * one narrow project lookup. Projects with zero tasks still appear (total: 0,
 * done: 0) so a brand-new project doesn't silently vanish from the list.
 */
export async function getManagerProjectProgress(
  scope: ManagerScope,
): Promise<ProjectProgress[]> {
  if (scope.projectIds.length === 0) return [];

  const [grouped, projects] = await Promise.all([
    prisma.task.groupBy({
      by: ["projectId", "status"],
      where: inScope(scope),
      _count: { _all: true },
    }),
    prisma.project.findMany({
      where: { id: { in: scope.projectIds } },
      orderBy: { name: "asc" },
      select: { id: true, key: true, name: true },
    }),
  ]);

  const totalsByProject = new Map<string, { total: number; done: number }>();
  for (const g of grouped) {
    const cur = totalsByProject.get(g.projectId) ?? { total: 0, done: 0 };
    cur.total += g._count._all;
    if (g.status === "DONE") cur.done += g._count._all;
    totalsByProject.set(g.projectId, cur);
  }

  return projects.map((p) => {
    const totals = totalsByProject.get(p.id) ?? { total: 0, done: 0 };
    return { projectId: p.id, key: p.key, name: p.name, ...totals };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Team activity
// ─────────────────────────────────────────────────────────────────────────────

/** Same row shape the dashboard's `ActivityFeed` component already renders. */
export type ActivityEntry = DashboardActivity;

/**
 * Recent activity across the manager's scoped projects. One relation-filtered
 * query with narrow actor/task picks — identical shape and query pattern to
 * `dashboard/queries.ts#getRecentActivity`, just scoped to managed projects
 * instead of personal memberships, so `ActivityFeed` can render it unchanged.
 */
export async function getManagerTeamActivity(
  scope: ManagerScope,
  limit = 20,
): Promise<ActivityEntry[]> {
  if (scope.projectIds.length === 0) return [];

  const rows = await prisma.activityLog.findMany({
    where: { task: inScope(scope) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      action: true,
      field: true,
      oldValue: true,
      newValue: true,
      createdAt: true,
      actor: { select: { id: true, name: true, avatarKey: true } },
      task: { select: { id: true, key: true, title: true, projectId: true } },
    },
  });

  return Promise.all(
    rows.map(async ({ actor, ...row }) => ({
      ...row,
      actor: {
        id: actor.id,
        name: actor.name,
        avatarUrl: await getAvatarUrl(actor.avatarKey),
      },
    })),
  );
}
