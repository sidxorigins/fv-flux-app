"use server";

// Notification mutations — mark read. Every action scopes to the signed-in
// user (a user can only touch their own notifications).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  requireProjectRole,
  requireUser,
} from "@/lib/permissions";
import {
  getNotificationsPage,
  type NotificationsPage,
} from "./queries";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function mapAuthError(err: unknown): { ok: false; error: string } | null {
  if (err instanceof AuthorizationError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return fail("You must be signed in.");
      case "SUSPENDED":
        return fail("Your account is suspended.");
      case "FORBIDDEN":
        return fail("You don't have permission to do that.");
    }
  }
  return null;
}

/** Mark one notification read (only if it belongs to the signed-in user). */
export async function markNotificationRead(
  notificationId: string,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await prisma.notification.updateMany({
      where: { id: notificationId, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Mark every unread notification read for the signed-in user. */
export async function markAllNotificationsRead(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/**
 * Client-callable wrapper over `getNotificationsPage` so the /inbox list can
 * "Load more" / switch the unread filter without a full navigation. Read-only;
 * still scoped to the signed-in user inside the query.
 */
export async function fetchNotificationsPage(params: {
  cursor?: string;
  unreadOnly?: boolean;
}): Promise<ActionResult<NotificationsPage>> {
  try {
    const page = await getNotificationsPage(params);
    return { ok: true, data: page };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/**
 * Toggle whether the signed-in user watches a task (VIEWER+ — anyone who can
 * see the task can follow it). Watching means you get its follow-up notices.
 * Returns the resulting state.
 */
export async function toggleWatchTask(
  taskId: string,
): Promise<ActionResult<{ watching: boolean }>> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) return fail("Task not found.");

    const { user } = await requireProjectRole(task.projectId, "VIEWER");

    const existing = await prisma.taskWatcher.findUnique({
      where: { taskId_userId: { taskId, userId: user.id } },
      select: { id: true },
    });
    if (existing) {
      await prisma.taskWatcher.delete({ where: { id: existing.id } });
    } else {
      await prisma.taskWatcher.create({ data: { taskId, userId: user.id } });
    }
    revalidatePath(`/projects/${task.projectId}`, "layout");
    return { ok: true, data: { watching: !existing } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}
