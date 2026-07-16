import "server-only";

// Read-side data access for a task's ActivityLog. Permission-checked (VIEWER+ via
// the task's project) — same shape/contract as features/comments/queries.ts and
// features/attachments/queries.ts (sibling drawer-slot data sources).

import { prisma } from "@/lib/db";
import { requireProjectRole } from "@/lib/permissions";
import type { User } from "@/generated/prisma/client";

/** Actor fields safe to expose to the client — never hashedPassword/email/etc. */
export type ActivityActor = Pick<User, "id" | "name" | "username" | "avatarKey">;

/** An ActivityLog row hydrated with its actor, as returned by `getTaskActivity`. */
export interface ActivityEntry {
  id: string;
  taskId: string;
  actorId: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  actor: ActivityActor;
}

/**
 * Activity for a task, most recent first, capped at 50 rows (a drawer panel, not
 * a full audit export). Throws `AuthorizationError` without VIEWER access to the
 * task's project. Returns `[]` for a non-existent task (nothing to show, nothing
 * leaked) — mirrors getComments/getAttachments.
 */
export async function getTaskActivity(taskId: string): Promise<ActivityEntry[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) return [];

  await requireProjectRole(task.projectId, "VIEWER");

  return prisma.activityLog.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      actor: {
        select: { id: true, name: true, username: true, avatarKey: true },
      },
    },
  });
}
