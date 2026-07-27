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
// row-level read is the attention list, which is capped. The page resolves the
// scope ONCE and passes it to each query so Promise.all() doesn't re-authorise
// six times; each query still resolves its own scope when called standalone.

import { prisma } from "@/lib/db";
import { requireExecutive } from "@/lib/permissions";
import {
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
export async function getExecutiveKpis(
  scope?: ExecutiveScope,
): Promise<ExecutiveKpis> {
  if (!scope) await requireExecutive();

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
export async function getOrgThroughput(
  scope?: ExecutiveScope,
): Promise<OrgThroughputWeek[]> {
  if (!scope) await requireExecutive();

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
