// Task creation kernel shared by the `createTask` Server Action (web UI) and the
// agent-facing API. Reference validation (assignee/parent/labels membership) is the
// CALLER's responsibility — this only mints the key, places the card, creates the row,
// and logs the activity, all on the passed transaction client.

import { sanitizeRichText } from "@/lib/sanitize";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskType, TaskStatus, TaskPriority } from "@/generated/prisma/enums";
import { computeMidpoint } from "./positioning";

export interface CreateTaskCoreInput {
  projectId: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string | null;
  description?: string | null;
  parentId?: string | null;
  dueDate?: Date | null;
  labelIds?: string[];
}

/**
 * Mint the task key (atomic counter bump), place it at the bottom of its status
 * column, create it with `reporterId = actorId`, and write a "created" ActivityLog
 * row — all on the passed transaction client. Reference validation
 * (assignee/parent/labels membership) is the CALLER's responsibility.
 */
export async function createTaskCore(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: CreateTaskCoreInput,
): Promise<{ id: string; key: string }> {
  const project = await tx.project.update({
    where: { id: input.projectId },
    data: { taskCounter: { increment: 1 } },
    select: { key: true, taskCounter: true },
  });
  const key = `${project.key}-${project.taskCounter}`;

  const agg = await tx.task.aggregate({
    where: { projectId: input.projectId, status: input.status },
    _max: { position: true },
  });
  const position = computeMidpoint(agg._max.position ?? null, null);

  const created = await tx.task.create({
    data: {
      projectId: input.projectId,
      key,
      title: input.title,
      description: input.description ? sanitizeRichText(input.description) : null,
      type: input.type,
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      reporterId: actorId,
      parentId: input.parentId ?? null,
      position,
      dueDate: input.dueDate ?? null,
      ...(input.labelIds?.length
        ? { labels: { connect: input.labelIds.map((id) => ({ id })) } }
        : {}),
    },
    select: { id: true, key: true },
  });

  await tx.activityLog.create({
    data: { taskId: created.id, actorId, action: "created" },
  });
  return created;
}
