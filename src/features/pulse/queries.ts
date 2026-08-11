// Org-wide "Team Pulse" read query — powers the admin wall board at
// /admin/pulse and the Events-replacement pane of the /display rotation.
// Server-only (DB + session).
//
// RELATIONSHIP TO features/team + features/manager: those answer "how is THIS
// team / MY projects doing" and are scoped by membership. This one answers
// "what is the whole company doing right now" and is scoped by nothing — which
// is exactly why it is ADMIN-ONLY. requireAdmin() runs first, before any query.
//
// The per-member aggregate shape deliberately mirrors
// features/team/queries.ts#getTeamProductivity (same groupBy patterns, same
// "working = running timer OR assigned IN_PROGRESS task" rule) so the two
// views can never disagree about whether someone is working. The addition here
// is `currentTask` — what they are on RIGHT NOW — which neither existing query
// surfaces.
//
// COMPLETIONS come from ActivityLog (status → DONE), not from Task.updatedAt,
// matching features/executive/queries.ts: updatedAt moves on any edit, so it
// would over-count. Rows are de-duped by taskId so a task bounced through Done
// twice in one week counts once.

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";
import { getAvatarUrl } from "@/features/users/avatar";
import { startOfIsoWeek } from "@/features/executive/weeks";
import { completionPct } from "@/features/team/shape";
import {
  elapsedMinutes,
  pickCurrentTask,
  sortPulseCards,
  type CurrentTaskCandidate,
} from "./shape";
import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";

const OPEN_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW"] as const;

// Wall-board visibility used to be a hardcoded username list here. It is now
// the User.showOnWallBoard column, configurable at /admin/display — the set of
// people worth putting on an office wall is an operational decision, not
// something that should need a deploy to change.
const COMPLETION_LOG = { field: "status", newValue: "DONE" } as const;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface PulseCurrentTask {
  taskId: string;
  key: string;
  title: string;
  projectKey: string;
  priority: TaskPriority;
  dueDate: Date | null;
  /** Minutes since work began. Null when the task is IN_PROGRESS but was never
   * timed — the wall board shows the task without a duration rather than
   * inventing one. */
  minutesOnTask: number | null;
  hasRunningTimer: boolean;
}

export interface PulseMember {
  userId: string;
  name: string;
  username: string;
  /** Short-lived presigned GET. The raw R2 `avatarKey` is deliberately NOT in
   * this shape — storage keys must never reach the client (CLAUDE.md). */
  avatarUrl: string | null;
  /** Same rule as features/team: a live timer OR an assigned IN_PROGRESS task. */
  availability: "working" | "idle";
  currentTask: PulseCurrentTask | null;
  todo: number;
  inProgress: number;
  inReview: number;
  /** Non-DONE assigned tasks past their due date. Cuts across the three open
   * buckets — not a fourth bucket. */
  overdue: number;
  /** todo + inProgress + inReview. */
  activeCount: number;
  completedThisWeek: number;
  completionPct: number;
  actualHoursThisWeek: number;
}

export interface PulseKpis {
  /** People currently working, and the headcount they're drawn from. */
  working: number;
  headcount: number;
  open: number;
  overdue: number;
  inReview: number;
  completedThisWeek: number;
}

export interface OrgPulse {
  kpis: PulseKpis;
  members: PulseMember[];
  /** Server render time — the wall board prints this so a frozen display is
   * visibly stale rather than silently wrong. */
  generatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everyone in the org and what they are doing right now. ADMIN-ONLY.
 *
 * Scope is every ACTIVE user: INVITED users have never signed in and SUSPENDED
 * users are blocked, so neither belongs on a wall board of live work.
 *
 * Cost: a fixed set of aggregate queries (groupBy / count), plus two narrow
 * findMany calls for the current-task candidates. No full task rows are loaded
 * for the counts — same discipline as features/manager/queries.ts.
 */
export async function getOrgPulse(): Promise<OrgPulse> {
  await requireAdmin();
  return loadOrgPulse();
}

/**
 * The query itself, WITHOUT an auth check.
 *
 * Split out so the wall board (/display) can call it after validating its own
 * DisplayToken — that route is not admin-session-gated, and calling
 * requireAdmin() there would reject the very credential it is meant to accept.
 * Anything calling this MUST have authorised the caller already.
 */
export async function loadOrgPulse(
  options: { includeHiddenFromWallBoard?: boolean } = {},
): Promise<OrgPulse> {
  const { includeHiddenFromWallBoard = true } = options;
  const now = new Date();
  const weekStart = startOfIsoWeek(now);

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      // Admin-configured per user. /admin/pulse passes true so an admin sees
      // every account; the wall board passes false.
      ...(includeHiddenFromWallBoard ? {} : { showOnWallBoard: true }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, username: true, avatarKey: true },
  });

  if (users.length === 0) {
    return {
      kpis: {
        working: 0,
        headcount: 0,
        open: 0,
        overdue: 0,
        inReview: 0,
        completedThisWeek: 0,
      },
      members: [],
      generatedAt: now,
    };
  }

  const userIds = users.map((u) => u.id);

  const [
    runningTimers,
    inProgressTasks,
    byStatus,
    overdueByAssignee,
    completionRows,
    minutesThisWeek,
    orgOpen,
    orgOverdue,
    orgInReview,
  ] = await Promise.all([
    // Live timers — the strongest "what are they on" signal. Carries the task
    // so we don't need a second round-trip to name it.
    prisma.timeEntry.findMany({
      where: { userId: { in: userIds }, endedAt: null },
      select: {
        userId: true,
        startedAt: true,
        task: {
          select: {
            id: true,
            key: true,
            title: true,
            priority: true,
            dueDate: true,
            project: { select: { key: true } },
          },
        },
      },
    }),
    // Assigned IN_PROGRESS work — counts as "working" even with no timer, since
    // starting one is optional (see features/team/queries.ts).
    prisma.task.findMany({
      where: { assigneeId: { in: userIds }, status: "IN_PROGRESS" },
      select: {
        id: true,
        key: true,
        title: true,
        priority: true,
        dueDate: true,
        assigneeId: true,
        project: { select: { key: true } },
      },
    }),
    prisma.task.groupBy({
      by: ["assigneeId", "status"],
      where: { assigneeId: { in: userIds } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["assigneeId"],
      where: {
        assigneeId: { in: userIds },
        status: { in: [...OPEN_STATUSES] },
        dueDate: { lt: now },
      },
      _count: { _all: true },
    }),
    prisma.activityLog.findMany({
      where: { ...COMPLETION_LOG, createdAt: { gte: weekStart } },
      select: { taskId: true, actorId: true },
    }),
    prisma.timeEntry.groupBy({
      by: ["userId"],
      where: {
        userId: { in: userIds },
        minutes: { not: null },
        startedAt: { gte: weekStart },
      },
      _sum: { minutes: true },
    }),
    prisma.task.count({ where: { status: { in: [...OPEN_STATUSES] } } }),
    prisma.task.count({
      where: { status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now } },
    }),
    prisma.task.count({ where: { status: "IN_REVIEW" } }),
  ]);

  // ── working set: timer OR in-progress assignment (union, per features/team)
  const workingSet = new Set(runningTimers.map((t) => t.userId));
  for (const t of inProgressTasks) {
    if (t.assigneeId) workingSet.add(t.assigneeId);
  }

  // ── current-task candidates per user
  const candidatesByUser = new Map<string, CurrentTaskCandidate[]>();
  const pushCandidate = (userId: string, c: CurrentTaskCandidate) => {
    const list = candidatesByUser.get(userId) ?? [];
    list.push(c);
    candidatesByUser.set(userId, list);
  };

  for (const timer of runningTimers) {
    pushCandidate(timer.userId, {
      taskId: timer.task.id,
      key: timer.task.key,
      title: timer.task.title,
      projectKey: timer.task.project.key,
      priority: timer.task.priority,
      dueDate: timer.task.dueDate,
      startedAt: timer.startedAt,
      hasRunningTimer: true,
    });
  }
  for (const task of inProgressTasks) {
    if (!task.assigneeId) continue;
    pushCandidate(task.assigneeId, {
      taskId: task.id,
      key: task.key,
      title: task.title,
      projectKey: task.project.key,
      priority: task.priority,
      dueDate: task.dueDate,
      startedAt: null,
      hasRunningTimer: false,
    });
  }

  // ── per-status counts
  const statusByUser = new Map<string, Record<TaskStatus, number>>();
  for (const g of byStatus) {
    if (!g.assigneeId) continue;
    const cur =
      statusByUser.get(g.assigneeId) ??
      ({ TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 } as Record<TaskStatus, number>);
    cur[g.status] += g._count._all;
    statusByUser.set(g.assigneeId, cur);
  }

  const overdueByUser = new Map<string, number>();
  for (const g of overdueByAssignee) {
    if (g.assigneeId) overdueByUser.set(g.assigneeId, g._count._all);
  }

  // De-dupe by taskId per actor: a task re-Done in the same week counts once.
  const completedTasksByUser = new Map<string, Set<string>>();
  const completedTaskIds = new Set<string>();
  for (const row of completionRows) {
    completedTaskIds.add(row.taskId);
    if (!row.actorId) continue;
    const set = completedTasksByUser.get(row.actorId) ?? new Set<string>();
    set.add(row.taskId);
    completedTasksByUser.set(row.actorId, set);
  }

  const minutesByUser = new Map(
    minutesThisWeek.map((g) => [g.userId, g._sum.minutes ?? 0]),
  );

  // Presigned avatar URLs, resolved server-side. getAvatarUrl memoises per key
  // for ~8 min, so a full-org board costs at most one presign per distinct
  // avatar rather than one per render.
  const avatarUrls = new Map(
    await Promise.all(
      users.map(
        async (u) => [u.id, await getAvatarUrl(u.avatarKey)] as const,
      ),
    ),
  );

  const members = users.map<PulseMember>((u) => {
    const counts =
      statusByUser.get(u.id) ??
      ({ TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 } as Record<TaskStatus, number>);
    const activeCount = counts.TODO + counts.IN_PROGRESS + counts.IN_REVIEW;
    const picked = pickCurrentTask(candidatesByUser.get(u.id) ?? []);

    return {
      userId: u.id,
      name: u.name,
      username: u.username,
      avatarUrl: avatarUrls.get(u.id) ?? null,
      availability: workingSet.has(u.id) ? "working" : "idle",
      currentTask: picked
        ? {
            taskId: picked.taskId,
            key: picked.key,
            title: picked.title,
            projectKey: picked.projectKey,
            priority: picked.priority,
            dueDate: picked.dueDate,
            minutesOnTask: picked.startedAt
              ? elapsedMinutes(picked.startedAt, now)
              : null,
            hasRunningTimer: picked.hasRunningTimer,
          }
        : null,
      todo: counts.TODO,
      inProgress: counts.IN_PROGRESS,
      inReview: counts.IN_REVIEW,
      overdue: overdueByUser.get(u.id) ?? 0,
      activeCount,
      completedThisWeek: completedTasksByUser.get(u.id)?.size ?? 0,
      completionPct: completionPct(counts.DONE, activeCount + counts.DONE),
      actualHoursThisWeek: round1((minutesByUser.get(u.id) ?? 0) / 60),
    };
  });

  return {
    kpis: {
      working: workingSet.size,
      headcount: users.length,
      open: orgOpen,
      overdue: orgOverdue,
      inReview: orgInReview,
      completedThisWeek: completedTaskIds.size,
    },
    members: sortPulseCards(members),
    generatedAt: now,
  };
}
