// Read-side data access for attachments. Permission-checked (VIEWER+). Server-
// only — never import from a client component (touches Prisma directly).

import { prisma } from "@/lib/db";
import { requireProjectRole } from "@/lib/permissions";

import type { AttachmentWithUploader } from "./types";

/**
 * Attachments for a task, newest first, each with a lightweight uploader
 * projection. Throws `AuthorizationError` without VIEWER access to the task's
 * project; returns `[]` for a non-existent task.
 */
export async function getAttachments(
  taskId: string,
): Promise<AttachmentWithUploader[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) return [];

  await requireProjectRole(task.projectId, "VIEWER");

  return prisma.attachment.findMany({
    // Task-level attachments only — comment attachments (commentId set) render
    // under their comment, not in the task's own attachment list.
    where: { taskId, commentId: null },
    orderBy: { createdAt: "desc" },
    include: {
      uploader: {
        select: { id: true, name: true, username: true, avatarKey: true },
      },
    },
  });
}
