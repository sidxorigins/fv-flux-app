import "server-only";

import { prisma } from "@/lib/db";
import { PROJECT_ROLE_ORDER, requireProjectRole, requireUser } from "@/lib/permissions";

const USER_BASIC = { id: true, name: true, username: true, avatarKey: true } as const;
type UserBasic = { id: string; name: string; username: string; avatarKey: string | null };

export interface RunningTimer {
  id: string;
  taskId: string;
  taskKey: string;
  projectId: string;
  startedAt: Date;
}

export interface PerUserTime { user: UserBasic; minutes: number }
export interface TimeEntryRow {
  id: string;
  minutes: number;
  startedAt: Date;
  endedAt: Date | null;
  user: UserBasic;
}
export interface TaskTime {
  totalMinutes: number;
  myMinutes: number;
  canManage: boolean;
  perUser: PerUserTime[] | null;
  entries: TimeEntryRow[];
}

/** The signed-in user's running timer, or null. */
export async function getRunningTimer(): Promise<RunningTimer | null> {
  const user = await requireUser();
  const r = await prisma.timeEntry.findFirst({
    where: { userId: user.id, endedAt: null },
    select: { id: true, taskId: true, startedAt: true, task: { select: { key: true, projectId: true } } },
  });
  return r
    ? { id: r.id, taskId: r.taskId, taskKey: r.task.key, projectId: r.task.projectId, startedAt: r.startedAt }
    : null;
}

/**
 * Time totals for a task. Everyone VIEWER+ sees `totalMinutes` + `myMinutes`.
 * The per-user breakdown + all entries are MANAGER/Admin-only; a member sees
 * `perUser: null` and only their own entries.
 */
export async function getTaskTime(taskId: string): Promise<TaskTime> {
  const empty: TaskTime = { totalMinutes: 0, myMinutes: 0, canManage: false, perUser: null, entries: [] };
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!task) return empty;

  const { user, role } = await requireProjectRole(task.projectId, "VIEWER");
  const canManage = PROJECT_ROLE_ORDER[role] >= PROJECT_ROLE_ORDER.MANAGER;
  const done = { endedAt: { not: null } } as const;

  const [totalAgg, myAgg] = await Promise.all([
    prisma.timeEntry.aggregate({ where: { taskId, ...done }, _sum: { minutes: true } }),
    prisma.timeEntry.aggregate({ where: { taskId, userId: user.id, ...done }, _sum: { minutes: true } }),
  ]);
  const totalMinutes = totalAgg._sum.minutes ?? 0;
  const myMinutes = myAgg._sum.minutes ?? 0;

  let perUser: PerUserTime[] | null = null;
  if (canManage) {
    const grouped = await prisma.timeEntry.groupBy({
      by: ["userId"],
      where: { taskId, ...done },
      _sum: { minutes: true },
    });
    if (grouped.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: grouped.map((g) => g.userId) } },
        select: USER_BASIC,
      });
      const byId = new Map(users.map((u) => [u.id, u]));
      perUser = grouped
        .map((g) => ({ user: byId.get(g.userId), minutes: g._sum.minutes ?? 0 }))
        .filter((r): r is PerUserTime => r.user !== undefined)
        .sort((a, b) => b.minutes - a.minutes);
    } else {
      perUser = [];
    }
  }

  const entries = await prisma.timeEntry.findMany({
    where: { taskId, ...done, ...(canManage ? {} : { userId: user.id }) },
    orderBy: { startedAt: "desc" },
    select: { id: true, minutes: true, startedAt: true, endedAt: true, user: { select: USER_BASIC } },
  });

  return {
    totalMinutes,
    myMinutes,
    canManage,
    perUser,
    entries: entries.map((e) => ({ ...e, minutes: e.minutes ?? 0 })),
  };
}
