// Notification read queries. Server-only (DB + session). All are scoped to the
// signed-in user — you only ever see your own notifications.

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import type { NotificationType } from "@/generated/prisma/enums";

const USER_BASIC = {
  id: true,
  name: true,
  username: true,
  avatarKey: true,
} as const;

export interface NotificationItem {
  id: string;
  type: NotificationType;
  taskId: string | null;
  projectId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  actorName: string | null;
  metadata: unknown;
  readAt: Date | null;
  createdAt: Date;
}

/** The signed-in user's most recent notifications (newest first). */
export async function getMyNotifications(limit = 20): Promise<NotificationItem[]> {
  const user = await requireUser();
  const take = Math.min(Math.max(limit, 1), 50);

  const rows = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      taskId: true,
      metadata: true,
      readAt: true,
      createdAt: true,
      actor: { select: USER_BASIC },
      task: { select: { key: true, title: true, projectId: true } },
    },
  });

  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    taskId: n.taskId,
    projectId: n.task?.projectId ?? null,
    taskKey: n.task?.key ?? null,
    taskTitle: n.task?.title ?? null,
    actorName: n.actor?.name ?? null,
    metadata: n.metadata,
    readAt: n.readAt,
    createdAt: n.createdAt,
  }));
}

/** Count of the signed-in user's unread notifications (for the bell badge). */
export async function getUnreadNotificationCount(): Promise<number> {
  const user = await requireUser();
  return prisma.notification.count({
    where: { userId: user.id, readAt: null },
  });
}

/** Whether the signed-in user watches a given task (drives the drawer toggle). */
export async function isWatchingTask(taskId: string): Promise<boolean> {
  const user = await requireUser();
  const watcher = await prisma.taskWatcher.findUnique({
    where: { taskId_userId: { taskId, userId: user.id } },
    select: { id: true },
  });
  return Boolean(watcher);
}
