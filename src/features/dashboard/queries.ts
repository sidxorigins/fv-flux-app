// Dashboard read queries. Server-only (DB + session), consumed by the dashboard
// Server Component — permission failures THROW to the nearest error boundary,
// matching the convention in features/tasks|projects/queries.ts.
//
// SCOPING (deliberate, documented): the dashboard is PERSONAL. Every query is
// scoped to the projects the session user has a ProjectMembership row for —
// even for global Admins. The admin-bypass policy in lib/permissions applies to
// acting on a project, not to what "my work at a glance" means; an Admin with
// no memberships sees an empty dashboard, not the whole company.
//
// EFFICIENCY: aggregates come from groupBy/count or narrow selects — no query
// here ever loads full task rows. The page resolves the scope ONCE via
// getDashboardScope() and passes it to each query so Promise.all() doesn't
// re-fetch the session user + membership list six times. Each query still
// resolves its own scope when called standalone.

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { getAvatarUrl } from "@/features/users/avatar";
import type { Prisma } from "@/generated/prisma/client";
import type { ProjectRole, TaskStatus } from "@/generated/prisma/enums";

// ─────────────────────────────────────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardScope {
  userId: string;
  /** Ids of projects the user is a MEMBER of (memberships only — see header). */
  projectIds: string[];
  /** Global Admin — used only to widen the project tiles to every project. */
  isAdmin: boolean;
}

/** Resolve the session user + their member-project ids in one pass. */
export async function getDashboardScope(): Promise<DashboardScope> {
  const user = await requireUser();
  const memberships = await prisma.projectMembership.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  return {
    userId: user.id,
    projectIds: memberships.map((m) => m.projectId),
    isAdmin: user.globalRole === "ADMIN",
  };
}

/** Where-fragment limiting tasks to the scope's member projects. */
function inScope(scope: DashboardScope): Prisma.TaskWhereInput {
  return { projectId: { in: scope.projectIds } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers (server-local time; deterministic, locale-independent)
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Midnight Monday of the ISO week containing `d` (server-local time). */
function startOfIsoWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); // Mon = 0
  return date;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "23 Jun" — deterministic label for a week-start date. */
function weekLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// A "completion" is an ActivityLog row with field="status", newValue="DONE" —
// written by every path that lands a task in Done (updateTask, moveTask,
// updateTaskStatus). Chosen over `updatedAt + status=DONE` because updatedAt
// moves on ANY edit, which would silently re-date old completions. Rows are
// de-duplicated per taskId per window so a task bounced out of Done and back
// counts once.
const COMPLETION_LOG: Prisma.ActivityLogWhereInput = {
  field: "status",
  newValue: "DONE",
};

// ─────────────────────────────────────────────────────────────────────────────
// KPIs
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardKpis {
  /** Tasks assigned to me, not Done. */
  openAssigned: number;
  /** Assigned to me, due within the next 7 days, not Done. */
  dueSoon: number;
  /** Assigned to me, past due, not Done. */
  overdue: number;
  /** Assigned to me, currently In Review. */
  inReview: number;
  /** Tasks assigned to me that reached Done this ISO week (Mon–now). */
  completedThisWeek: number;
  /** Same for the previous ISO week — the delta baseline. */
  completedLastWeek: number;
}

/**
 * All six numbers about MY work. Four parallel aggregate queries, no task rows:
 *  1. groupBy(status) over my open assigned tasks → openAssigned + inReview
 *  2. count() → dueSoon        3. count() → overdue
 *  4. one narrow ActivityLog select spanning both weeks → completed this/last
 * "Completed" = status→DONE activity on tasks assigned to me (my work reached
 * Done), regardless of who clicked — see COMPLETION_LOG note above.
 */
export async function getKpis(scope?: DashboardScope): Promise<DashboardKpis> {
  const s = scope ?? (await getDashboardScope());
  const now = new Date();
  const thisWeekStart = startOfIsoWeek(now);
  const lastWeekStart = new Date(thisWeekStart.getTime() - WEEK_MS);
  const in7Days = new Date(now.getTime() + 7 * DAY_MS);

  const myOpen: Prisma.TaskWhereInput = {
    ...inScope(s),
    assigneeId: s.userId,
    status: { not: "DONE" },
  };

  const [byStatus, dueSoon, overdue, completions] = await Promise.all([
    prisma.task.groupBy({
      by: ["status"],
      where: myOpen,
      _count: { _all: true },
    }),
    prisma.task.count({
      where: { ...myOpen, dueDate: { gte: now, lt: in7Days } },
    }),
    prisma.task.count({ where: { ...myOpen, dueDate: { lt: now } } }),
    prisma.activityLog.findMany({
      where: {
        ...COMPLETION_LOG,
        createdAt: { gte: lastWeekStart },
        task: { ...inScope(s), assigneeId: s.userId },
      },
      select: { taskId: true, createdAt: true },
    }),
  ]);

  const openAssigned = byStatus.reduce((sum, g) => sum + g._count._all, 0);
  const inReview =
    byStatus.find((g) => g.status === "IN_REVIEW")?._count._all ?? 0;

  const thisWeek = new Set<string>();
  const lastWeek = new Set<string>();
  for (const row of completions) {
    (row.createdAt >= thisWeekStart ? thisWeek : lastWeek).add(row.taskId);
  }

  return {
    openAssigned,
    dueSoon,
    overdue,
    inReview,
    completedThisWeek: thisWeek.size,
    completedLastWeek: lastWeek.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status distribution
// ─────────────────────────────────────────────────────────────────────────────

export type StatusDistribution = { status: TaskStatus; count: number }[];

/** Task counts by status across my member projects — one groupBy, zero-filled. */
export async function getStatusDistribution(
  scope?: DashboardScope,
): Promise<StatusDistribution> {
  const s = scope ?? (await getDashboardScope());

  const grouped = await prisma.task.groupBy({
    by: ["status"],
    where: inScope(s),
    _count: { _all: true },
  });
  const counts = new Map(grouped.map((g) => [g.status, g._count._all]));

  const order: TaskStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];
  return order.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Throughput (completed per week, last 8 ISO weeks)
// ─────────────────────────────────────────────────────────────────────────────

export interface ThroughputWeek {
  /** "23 Jun" — deterministic week-start label for the chart axis. */
  label: string;
  completed: number;
}

/**
 * Distinct tasks completed per ISO week across my member projects, for the
 * last 8 weeks (current week included). One filtered ActivityLog query
 * selecting only { taskId, createdAt }; bucketing happens in JS — at internal
 * scale that projection is tiny (a few hundred rows at most) and cheaper than
 * shipping a raw-SQL date_trunc grouping for it.
 */
export async function getThroughput(
  scope?: DashboardScope,
): Promise<ThroughputWeek[]> {
  const s = scope ?? (await getDashboardScope());

  const WEEKS = 8;
  const thisWeekStart = startOfIsoWeek(new Date());
  const windowStart = new Date(thisWeekStart.getTime() - (WEEKS - 1) * WEEK_MS);

  const rows = await prisma.activityLog.findMany({
    where: {
      ...COMPLETION_LOG,
      createdAt: { gte: windowStart },
      task: inScope(s),
    },
    select: { taskId: true, createdAt: true },
  });

  // De-dupe per (week, task): a task that bounced through Done twice in a
  // week is one unit of throughput.
  const buckets = Array.from({ length: WEEKS }, () => new Set<string>());
  for (const row of rows) {
    const idx = Math.floor(
      (startOfIsoWeek(row.createdAt).getTime() - windowStart.getTime()) /
        WEEK_MS,
    );
    if (idx >= 0 && idx < WEEKS) buckets[idx].add(row.taskId);
  }

  return buckets.map((set, i) => ({
    label: weekLabel(new Date(windowStart.getTime() + i * WEEK_MS)),
    completed: set.size,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Workload by assignee
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkloadEntry {
  userId: string;
  name: string;
  openTasks: number;
}

/**
 * Open (not-Done) task counts grouped by assignee across my member projects —
 * top 8. Exactly two queries: a groupBy for the counts, then one user lookup
 * for display names. Unassigned tasks are excluded (they aren't anyone's
 * workload). No avatar URLs here: the bar chart renders names only, and
 * presigning R2 URLs that never render would be wasted API calls.
 */
export async function getWorkload(
  scope?: DashboardScope,
): Promise<WorkloadEntry[]> {
  const s = scope ?? (await getDashboardScope());

  const grouped = await prisma.task.groupBy({
    by: ["assigneeId"],
    where: {
      ...inScope(s),
      status: { not: "DONE" },
      assigneeId: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { assigneeId: "desc" } },
    take: 8,
  });
  if (grouped.length === 0) return [];

  const ids = grouped.map((g) => g.assigneeId).filter((id) => id !== null);
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return grouped
    .filter((g) => g.assigneeId !== null)
    .map((g) => ({
      userId: g.assigneeId as string,
      name: nameById.get(g.assigneeId as string) ?? "Unknown",
      openTasks: g._count._all,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent activity
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardActivity {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  actor: { id: string; name: string; avatarUrl: string | null };
  task: { id: string; key: string; title: string; projectId: string };
}

/**
 * Latest activity across my member projects. One relation-filtered query with
 * narrow actor/task picks; actor avatars resolve through the memoised presign
 * cache in features/users/avatar (repeat actors cost one R2 call).
 */
export async function getRecentActivity(
  limit = 12,
  scope?: DashboardScope,
): Promise<DashboardActivity[]> {
  const s = scope ?? (await getDashboardScope());

  const rows = await prisma.activityLog.findMany({
    where: { task: inScope(s) },
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

// ─────────────────────────────────────────────────────────────────────────────
// Project tiles
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectTile {
  id: string;
  key: string;
  name: string;
  role: ProjectRole;
  openTaskCount: number;
}

/**
 * Slim variant of getMyProjects for the bento tiles. For a global Admin this
 * lists EVERY project (one-click access to any board from the landing page);
 * for everyone else it's their memberships only. Open-task count comes from a
 * filtered `_count`, never task rows. (Note: the rest of the dashboard — KPIs,
 * charts, my work — stays personal-scope even for admins; only these shortcut
 * tiles widen.)
 */
export async function getProjectTiles(
  scope?: DashboardScope,
): Promise<ProjectTile[]> {
  const s = scope ?? (await getDashboardScope());

  const tileSelect = {
    id: true,
    key: true,
    name: true,
    _count: { select: { tasks: { where: { status: { not: "DONE" as const } } } } },
  };

  if (s.isAdmin) {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: tileSelect,
    });
    return projects.map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
      role: "MANAGER", // admin effective role (bypass policy, matches getMyProjects)
      openTaskCount: project._count.tasks,
    }));
  }

  const memberships = await prisma.projectMembership.findMany({
    where: { userId: s.userId },
    orderBy: { project: { createdAt: "desc" } },
    select: {
      projectRole: true,
      project: { select: tileSelect },
    },
  });

  return memberships.map(({ projectRole, project }) => ({
    id: project.id,
    key: project.key,
    name: project.name,
    role: projectRole,
    openTaskCount: project._count.tasks,
  }));
}
