// Notification fan-out — internal server helper (NOT a "use server" module).
// Called from task/comment actions AFTER their write commits. Never throws:
// a notification failure must never fail the action that triggered it.

import { prisma } from "@/lib/db";
import type { NotificationType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

interface NotifyParams {
  /** Intended recipients (will be deduped and the actor removed). */
  recipientIds: string[];
  /** Who caused the event — never notified about their own action. */
  actorId: string;
  type: NotificationType;
  taskId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Create one notification per distinct recipient (excluding the actor and any
 * non-ACTIVE user). Best-effort: swallows and logs errors so the caller's
 * result is unaffected.
 */
export async function notify(params: NotifyParams): Promise<void> {
  try {
    const recipients = [...new Set(params.recipientIds)].filter(
      (id) => id && id !== params.actorId,
    );
    if (recipients.length === 0) return;

    // Only notify active accounts (skip suspended / invited).
    const active = await prisma.user.findMany({
      where: { id: { in: recipients }, status: "ACTIVE" },
      select: { id: true },
    });
    if (active.length === 0) return;

    await prisma.notification.createMany({
      data: active.map(({ id }) => ({
        userId: id,
        actorId: params.actorId,
        type: params.type,
        taskId: params.taskId ?? null,
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
      })),
    });
  } catch (err) {
    console.error("[notify] failed", err);
  }
}

/**
 * The set of users who should hear about activity on a task: its explicit
 * watchers plus the current assignee and reporter. Returns distinct ids.
 */
export async function getTaskAudience(taskId: string): Promise<string[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      assigneeId: true,
      reporterId: true,
      watchers: { select: { userId: true } },
    },
  });
  if (!task) return [];
  const ids = [
    task.assigneeId,
    task.reporterId,
    ...task.watchers.map((w) => w.userId),
  ].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/**
 * Ensure a user watches a task (idempotent). Used to auto-subscribe people who
 * engage with a task (commenting, being assigned) so they get follow-up notices.
 */
export async function ensureWatching(
  taskId: string,
  userId: string,
): Promise<void> {
  try {
    await prisma.taskWatcher.upsert({
      where: { taskId_userId: { taskId, userId } },
      update: {},
      create: { taskId, userId },
    });
  } catch (err) {
    console.error("[ensureWatching] failed", err);
  }
}
