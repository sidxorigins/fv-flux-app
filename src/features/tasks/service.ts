// Task creation kernel shared by the `createTask` Server Action (web UI) and the
// agent-facing API. Reference validation (assignee/parent/labels membership) is the
// CALLER's responsibility — this only mints the key, places the card, creates the row,
// and logs the activity, all on the passed transaction client.

import { prisma } from "@/lib/db";
import { sanitizeRichText } from "@/lib/sanitize";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskType, TaskStatus, TaskPriority } from "@/generated/prisma/enums";
import { getTaskAudience, notify } from "@/features/notifications/service";
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

/**
 * Set a task's status on behalf of an actor (the agent-API path — no session,
 * caller has already authorised). Updates the status, writes a "status_changed"
 * ActivityLog row (in one transaction), and best-effort notifies the task's
 * audience — mirroring the `updateTaskStatus` Server Action. Returns null if the
 * task doesn't exist; a no-op (but still returns the task) when the status is
 * unchanged.
 */
export async function setTaskStatusForActor(
  actorId: string,
  taskId: string,
  status: TaskStatus,
): Promise<{ id: string; key: string; status: TaskStatus } | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, key: true, status: true },
  });
  if (!task) return null;
  if (task.status === status) return { id: task.id, key: task.key, status };

  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: { status } });
    await tx.activityLog.create({
      data: {
        taskId,
        actorId,
        action: "status_changed",
        field: "status",
        oldValue: task.status,
        newValue: status,
      },
    });
  });

  // Best-effort notify — the status change has already committed, so nothing in
  // the audience-fetch/notify path may fail the request (notify swallows its own
  // errors; wrap getTaskAudience too so a read blip can't 500 a done update).
  try {
    const audience = await getTaskAudience(taskId);
    await notify({
      recipientIds: audience,
      actorId,
      type: "TASK_STATUS_CHANGED",
      taskId,
      metadata: { from: task.status, to: status },
    });
  } catch (err) {
    console.error("[setTaskStatusForActor] notify failed", err);
  }

  return { id: task.id, key: task.key, status };
}
