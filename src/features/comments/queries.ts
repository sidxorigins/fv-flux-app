// Read-side data access for comments. Permission-checked (VIEWER+) so a user can
// only read comments on a task inside a project they have access to. Server-only
// — never import this from a client component (it touches Prisma directly).

import { prisma } from "@/lib/db";
import { requireProjectRole } from "@/lib/permissions";

import type { CommentWithAuthor } from "./types";

/**
 * Comments for a task, oldest first (chronological reading order), each with a
 * lightweight author projection (never the password hash/email). Throws
 * `AuthorizationError` if the caller lacks VIEWER access to the task's project.
 * Returns `[]` for a non-existent task (nothing to show, nothing leaked).
 */
export async function getComments(taskId: string): Promise<CommentWithAuthor[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) return [];

  await requireProjectRole(task.projectId, "VIEWER");

  return prisma.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        select: { id: true, name: true, username: true, avatarKey: true },
      },
    },
  });
}
