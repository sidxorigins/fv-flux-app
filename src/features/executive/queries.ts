// Executive Overview read queries. Server-only (DB + session), consumed by the
// /executive Server Component — permission failures THROW to the nearest error
// boundary, matching features/dashboard|manager/queries.ts.
//
// SCOPING (deliberate, documented): unlike the PERSONAL dashboard, every figure
// here is ORG-WIDE — all projects, all people, regardless of the viewer's
// memberships. That is the whole point of the view. `scope.memberProjectIds`
// exists ONLY so the UI can decide which project cards are clickable; it never
// filters an aggregate.
//
// EFFICIENCY: aggregates come from groupBy/count or narrow selects. The ONLY
// row-level read is the attention list (added in a later task), which is
// capped. The page resolves the scope ONCE (getExecutiveScope) and passes it
// only to the queries that actually read `memberProjectIds`, so Promise.all()
// doesn't repeat the membership lookup for each of those; each such query
// still resolves its own scope when called standalone. The purely org-wide
// queries below take no scope parameter — see AUTHORISATION.
//
// AUTHORISATION: every exported query calls requireExecutive() UNCONDITIONALLY —
// none of them accept a `scope` as a shortcut past it. `scope` is data, never a
// capability token: it is a plain structural interface, so trusting its mere
// presence would let any object of that shape (a test helper, a future caching
// layer, a refactor) read org-wide figures without ever having gone through
// requireExecutive(). The purely org-wide queries in THIS file (getExecutiveKpis,
// getOrgThroughput) take no scope parameter at all — there is nothing in `scope`
// they need. Later queries that genuinely read `scope.memberProjectIds` (to
// decide which project cards/rows are clickable) keep the parameter — but still
// call requireExecutive() unconditionally themselves. This is cheap either way
// because requireUser() (which requireExecutive() calls) is request-memoised via
// React cache() — see lib/permissions.ts — so repeating the check in every query
// costs one DB lookup per request, not one per query.

import { prisma } from "@/lib/db";
import { requireExecutive } from "@/lib/permissions";
import { projectHealth, type ProjectHealth } from "./health";
import {
  DAY_MS,
  WEEK_MS,
  splitCompletionsByWeek,
  startOfIsoWeek,
  weekLabel,
} from "./weeks";

// ─────────────────────────────────────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutiveScope {
  userId: string;
  /**
   * Projects this viewer may actually OPEN — their ProjectMembership rows, or
   * every project when they are a global Admin (admin-bypass policy). Used for
   * link/lock rendering only, never to filter an aggregate.
   */
  memberProjectIds: Set<string>;
}

export async function getExecutiveScope(): Promise<ExecutiveScope> {
  const user = await requireExecutive();

  if (user.globalRole === "ADMIN") {
    const projects = await prisma.project.findMany({ select: { id: true } });
    return { userId: user.id, memberProjectIds: new Set(projects.map((p) => p.id)) };
  }

  const memberships = await prisma.projectMembership.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  return {
    userId: user.id,
    memberProjectIds: new Set(memberships.map((m) => m.projectId)),
  };
}

// A "completion" is an ActivityLog row with field="status", newValue="DONE" —
// written by every path that lands a task in Done. Chosen over
// `updatedAt + status=DONE` because updatedAt moves on ANY edit, which would
// silently re-date old completions. Identical to the dashboard's definition so
// the two views never disagree about what "completed" means.
const COMPLETION_LOG = { field: "status", newValue: "DONE" } as const;

const OPEN_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Org KPIs
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutiveKpis {
  open: number;
  openLastWeek: number;
  completedThisWeek: number;
  completedLastWeek: number;
  overdue: number;
  overdueLastWeek: number;
  inReview: number;
}

/**
 * The four headline numbers plus their prior-week baselines.
 *
 * "openLastWeek" and "overdueLastWeek" are point-in-time reconstructions: tasks
 * that already existed at the start of this week and are still open / already
 * overdue. They are deliberately approximations — Flux does not snapshot task
 * state — and are used only to render a direction-of-travel delta chip.
 */
export async function getExecutiveKpis(): Promise<ExecutiveKpis> {
  // UNCONDITIONAL: a scope is never an authorisation token. ExecutiveScope is a
  // plain structural interface, so trusting one would let any object of that
  // shape read org-wide figures. requireUser() is request-memoised (see
  // lib/permissions.ts), so re-authorising in every query costs one DB lookup
  // per request, not one per query.
  await requireExecutive();

  const now = new Date();
  const thisWeekStart = startOfIsoWeek(now);
  const lastWeekStart = new Date(thisWeekStart.getTime() - WEEK_MS);

  const [byStatus, openAtWeekStart, overdue, overdueAtWeekStart, completions] =
    await Promise.all([
      prisma.task.groupBy({
        by: ["status"],
        where: { status: { in: [...OPEN_STATUSES] } },
        _count: { _all: true },
      }),
      prisma.task.count({
        where: {
          status: { in: [...OPEN_STATUSES] },
          createdAt: { lt: thisWeekStart },
        },
      }),
      prisma.task.count({
        where: { status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now } },
      }),
      prisma.task.count({
        where: {
          status: { in: [...OPEN_STATUSES] },
          dueDate: { lt: thisWeekStart },
        },
      }),
      prisma.activityLog.findMany({
        where: { ...COMPLETION_LOG, createdAt: { gte: lastWeekStart } },
        select: { taskId: true, createdAt: true },
      }),
    ]);

  const countFor = (status: string): number =>
    byStatus.find((g) => g.status === status)?._count._all ?? 0;

  // De-dupe per (week, task) — see splitCompletionsByWeek in ./weeks.
  const { thisWeek, lastWeek } = splitCompletionsByWeek(completions, thisWeekStart);

  return {
    open: OPEN_STATUSES.reduce((sum, s) => sum + countFor(s), 0),
    openLastWeek: openAtWeekStart,
    completedThisWeek: thisWeek.size,
    completedLastWeek: lastWeek.size,
    overdue,
    overdueLastWeek: overdueAtWeekStart,
    inReview: countFor("IN_REVIEW"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Org throughput — created vs completed, 8 weeks
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgThroughputWeek {
  label: string;
  created: number;
  completed: number;
}

/** Two narrow reads over an 8-week window, bucketed in memory. */
export async function getOrgThroughput(): Promise<OrgThroughputWeek[]> {
  await requireExecutive(); // unconditional — see getExecutiveKpis

  const WEEKS = 8;
  const thisWeekStart = startOfIsoWeek(new Date());
  const windowStart = new Date(thisWeekStart.getTime() - (WEEKS - 1) * WEEK_MS);

  const [completionRows, createdRows] = await Promise.all([
    prisma.activityLog.findMany({
      where: { ...COMPLETION_LOG, createdAt: { gte: windowStart } },
      select: { taskId: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { id: true, createdAt: true },
    }),
  ]);

  const bucketIndex = (d: Date): number =>
    Math.floor(
      (startOfIsoWeek(d).getTime() - windowStart.getTime()) / WEEK_MS,
    );

  const completed = Array.from({ length: WEEKS }, () => new Set<string>());
  for (const row of completionRows) {
    const i = bucketIndex(row.createdAt);
    if (i >= 0 && i < WEEKS) completed[i]!.add(row.taskId);
  }

  const created = Array.from({ length: WEEKS }, () => 0);
  for (const row of createdRows) {
    const i = bucketIndex(row.createdAt);
    if (i >= 0 && i < WEEKS) created[i]! += 1;
  }

  return Array.from({ length: WEEKS }, (_, i) => ({
    label: weekLabel(new Date(windowStart.getTime() + i * WEEK_MS)),
    created: created[i]!,
    completed: completed[i]!.size,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Project health board
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutiveProject {
  id: string;
  key: string;
  name: string;
  leadName: string;
  done: number;
  total: number;
  open: number;
  inReview: number;
  overdue: number;
  unassignedUrgent: number;
  activity7d: number;
  activity14d: number;
  /** Completions per week over the last 6 weeks — the card sparkline. */
  spark: number[];
  health: ProjectHealth;
  /** False → render the card as a locked, non-navigable tile. */
  canOpen: boolean;
}

const HEALTH_ORDER: Record<ProjectHealth, number> = {
  STALLED: 0,
  AT_RISK: 1,
  ON_TRACK: 2,
};

/**
 * Every project with its card figures, worst health first.
 *
 * Six queries TOTAL regardless of project count — never N per project. Each
 * grouped read is keyed by projectId and zipped in memory.
 */
export async function getProjectHealth(
  scope?: ExecutiveScope,
): Promise<ExecutiveProject[]> {
  await requireExecutive(); // unconditional — see getExecutiveKpis
  const s = scope ?? (await getExecutiveScope());

  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since14d = new Date(now.getTime() - 14 * DAY_MS);
  const SPARK_WEEKS = 6;
  const thisWeekStart = startOfIsoWeek(now);
  const sparkStart = new Date(
    thisWeekStart.getTime() - (SPARK_WEEKS - 1) * WEEK_MS,
  );

  const projects = await prisma.project.findMany({
    select: { id: true, key: true, name: true, lead: { select: { name: true } } },
  });
  if (projects.length === 0) return [];

  const [statusCounts, overdueCounts, urgentCounts, activityRows, completionRows] =
    await Promise.all([
      prisma.task.groupBy({
        by: ["projectId", "status"],
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["projectId"],
        where: { status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now } },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ["projectId"],
        where: {
          status: { in: [...OPEN_STATUSES] },
          priority: "URGENT",
          assigneeId: null,
        },
        _count: { _all: true },
      }),
      prisma.activityLog.findMany({
        where: { createdAt: { gte: since14d } },
        select: { createdAt: true, task: { select: { projectId: true } } },
      }),
      prisma.activityLog.findMany({
        where: { ...COMPLETION_LOG, createdAt: { gte: sparkStart } },
        select: {
          taskId: true,
          createdAt: true,
          task: { select: { projectId: true } },
        },
      }),
    ]);

  const statusFor = (projectId: string, status: string): number =>
    statusCounts.find((g) => g.projectId === projectId && g.status === status)
      ?._count._all ?? 0;
  const scalarFor = (
    rows: { projectId: string; _count: { _all: number } }[],
    projectId: string,
  ): number => rows.find((g) => g.projectId === projectId)?._count._all ?? 0;

  const activity7d = new Map<string, number>();
  const activity14d = new Map<string, number>();
  for (const row of activityRows) {
    const id = row.task.projectId;
    activity14d.set(id, (activity14d.get(id) ?? 0) + 1);
    if (row.createdAt >= since7d) {
      activity7d.set(id, (activity7d.get(id) ?? 0) + 1);
    }
  }

  // Per-project, per-week completion sets (de-duped by taskId, as elsewhere).
  const sparks = new Map<string, Set<string>[]>();
  for (const row of completionRows) {
    const id = row.task.projectId;
    const i = Math.floor(
      (startOfIsoWeek(row.createdAt).getTime() - sparkStart.getTime()) / WEEK_MS,
    );
    if (i < 0 || i >= SPARK_WEEKS) continue;
    let weeks = sparks.get(id);
    if (!weeks) {
      weeks = Array.from({ length: SPARK_WEEKS }, () => new Set<string>());
      sparks.set(id, weeks);
    }
    weeks[i]!.add(row.taskId);
  }

  const cards = projects.map((p): ExecutiveProject => {
    const todo = statusFor(p.id, "TODO");
    const inProgress = statusFor(p.id, "IN_PROGRESS");
    const inReview = statusFor(p.id, "IN_REVIEW");
    const done = statusFor(p.id, "DONE");
    const open = todo + inProgress + inReview;
    const overdue = scalarFor(overdueCounts, p.id);
    const unassignedUrgent = scalarFor(urgentCounts, p.id);
    const seen14d = activity14d.get(p.id) ?? 0;

    return {
      id: p.id,
      key: p.key,
      name: p.name,
      leadName: p.lead.name,
      done,
      total: open + done,
      open,
      inReview,
      overdue,
      unassignedUrgent,
      activity7d: activity7d.get(p.id) ?? 0,
      activity14d: seen14d,
      spark: (sparks.get(p.id) ?? []).map((set) => set.size),
      health: projectHealth({
        open,
        overdue,
        unassignedUrgent,
        activity14d: seen14d,
      }),
      canOpen: s.memberProjectIds.has(p.id),
    };
  });

  return cards.sort(
    (a, b) =>
      HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || b.open - a.open,
  );
}
