// Session-free time-tracking DB operations, shared by the UI Server Actions and
// the /api/v1 route handlers. Callers do their own authorisation first.
import { prisma } from "@/lib/db";

function minutesBetween(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
}

/** Auto-stop the user's running timer (if any) and start a new one on `taskId`. */
export async function startTimerForUser(
  userId: string,
  taskId: string,
): Promise<{ stoppedTaskKey: string | null }> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const running = await tx.timeEntry.findFirst({
      where: { userId, endedAt: null },
      select: { id: true, startedAt: true, task: { select: { key: true } } },
    });
    let stoppedTaskKey: string | null = null;
    if (running) {
      await tx.timeEntry.update({
        where: { id: running.id },
        data: { endedAt: now, minutes: minutesBetween(running.startedAt, now) },
      });
      stoppedTaskKey = running.task.key;
    }
    await tx.timeEntry.create({ data: { taskId, userId, startedAt: now } });
    return { stoppedTaskKey };
  });
}

/** Close the user's running timer. `projectId` is returned for revalidation. */
export async function stopTimerForUser(
  userId: string,
): Promise<{ stopped: boolean; projectId: string | null }> {
  const running = await prisma.timeEntry.findFirst({
    where: { userId, endedAt: null },
    select: { id: true, startedAt: true, task: { select: { projectId: true } } },
  });
  if (!running) return { stopped: false, projectId: null };
  const now = new Date();
  await prisma.timeEntry.update({
    where: { id: running.id },
    data: { endedAt: now, minutes: minutesBetween(running.startedAt, now) },
  });
  return { stopped: true, projectId: running.task.projectId };
}

/** Insert a COMPLETED entry (no timer state) — the concurrency-safe log path. */
export async function logTimeForUser(
  userId: string,
  taskId: string,
  minutes: number,
  opts?: { note?: string; spentAt?: Date },
): Promise<{ id: string }> {
  const end = opts?.spentAt ?? new Date();
  const start = new Date(end.getTime() - minutes * 60000);
  return prisma.timeEntry.create({
    data: { taskId, userId, startedAt: start, endedAt: end, minutes, note: opts?.note ?? null },
    select: { id: true },
  });
}

/** The user's running timer, or null. */
export async function getRunningForUser(userId: string) {
  const r = await prisma.timeEntry.findFirst({
    where: { userId, endedAt: null },
    select: { taskId: true, startedAt: true, task: { select: { key: true, projectId: true } } },
  });
  return r
    ? { taskId: r.taskId, taskKey: r.task.key, projectId: r.task.projectId, startedAt: r.startedAt }
    : null;
}
