"use server";

// Task Server Actions. Every action: Zod-validate → permission helper from
// lib/permissions → all writes in ONE transaction → revalidate. Rich text is always
// run through lib/sanitize before persisting. Returns the discriminated `{ ok }` union.
//
// Ordering on the board uses fractional positions (see ./positioning). Task keys are
// generated per-project from an atomic counter increment inside the create transaction.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { sendTaskAssignedEmail } from "@/lib/mail";
import { deleteObjects } from "@/lib/r2";
import { sanitizeRichText } from "@/lib/sanitize";
import {
  AuthorizationError,
  requireProjectRole,
} from "@/lib/permissions";
import { Prisma } from "@/generated/prisma/client";
import type { TaskStatus } from "@/generated/prisma/enums";
import {
  computeMidpoint,
  needsRebalance,
  rebalancedPositions,
} from "./positioning";
import {
  createTaskSchema,
  deleteTaskSchema,
  moveTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
} from "./schemas";
import { searchEverything, type SearchResults } from "./queries";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Thrown inside a transaction to abort with a specific user-facing message. */
class ActionError extends Error {}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2025"
  );
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

function revalidateProjectViews(projectId: string): void {
  revalidatePath("/dashboard");
  // "layout" revalidates every nested route under the project (board, backlog, tasks).
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** Assert `userId` is a member of `projectId`; throws ActionError otherwise. */
async function assertProjectMember(
  tx: Prisma.TransactionClient,
  projectId: string,
  userId: string,
): Promise<void> {
  const membership = await tx.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true },
  });
  if (!membership) {
    throw new ActionError("The assignee must be a member of the project.");
  }
}

/** Assert every id in `labelIds` is a label of `projectId`; throws ActionError otherwise. */
async function assertLabelsInProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  labelIds: string[],
): Promise<void> {
  if (labelIds.length === 0) return;
  const unique = [...new Set(labelIds)];
  const found = await tx.label.findMany({
    where: { id: { in: unique }, projectId },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw new ActionError("One or more labels don't belong to this project.");
  }
}

/**
 * Email the assignee that a task landed on their plate. Runs AFTER the write
 * transaction commits; failures are logged inside sendTaskAssignedEmail and
 * never affect the action result. Self-assignment sends nothing.
 */
async function notifyAssignee(params: {
  taskId: string;
  assigneeId: string;
  actorId: string;
  actorName: string;
}): Promise<void> {
  if (params.assigneeId === params.actorId) return;

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      key: true,
      title: true,
      projectId: true,
      project: { select: { name: true } },
      assignee: { select: { email: true, status: true } },
    },
  });
  if (!task?.assignee || task.assignee.status !== "ACTIVE") return;

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  await sendTaskAssignedEmail({
    to: task.assignee.email,
    taskKey: task.key,
    taskTitle: task.title,
    projectName: task.project.name,
    assignedByName: params.actorName,
    taskUrl: `${base}/projects/${task.projectId}?task=${params.taskId}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// createTask — project MEMBER+
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a task. In one transaction: validate assignee/parent/labels, atomically bump
 * the project's task counter to mint the `<KEY>-<n>` key, place the card at the bottom
 * of the TODO column, create the task, and write a "created" ActivityLog row.
 *
 * v1 rule: a subtask can be one level deep only — the parent must be a top-level task
 * in the same project. Assignee and labels must belong to the same project.
 */
export async function createTask(
  input: unknown,
): Promise<ActionResult<{ id: string; key: string }>> {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const {
    projectId,
    title,
    description,
    type,
    priority,
    assigneeId,
    parentId,
    dueDate,
    labelIds,
  } = parsed.data;

  try {
    const { user } = await requireProjectRole(projectId, "MEMBER");

    const task = await prisma.$transaction(async (tx) => {
      // Validate references BEFORE bumping the counter so a failure doesn't burn a key.
      if (assigneeId) await assertProjectMember(tx, projectId, assigneeId);
      if (parentId) {
        const parent = await tx.task.findUnique({
          where: { id: parentId },
          select: { projectId: true, parentId: true },
        });
        if (!parent || parent.projectId !== projectId) {
          throw new ActionError("The parent task doesn't belong to this project.");
        }
        if (parent.parentId !== null) {
          throw new ActionError("Subtasks can only be one level deep.");
        }
      }
      if (labelIds?.length) await assertLabelsInProject(tx, projectId, labelIds);

      // Atomic counter bump → the returned value is unique per project (row-locked).
      const project = await tx.project.update({
        where: { id: projectId },
        data: { taskCounter: { increment: 1 } },
        select: { key: true, taskCounter: true },
      });
      const key = `${project.key}-${project.taskCounter}`;

      // Place at the bottom of the TODO column.
      const agg = await tx.task.aggregate({
        where: { projectId, status: "TODO" },
        _max: { position: true },
      });
      const position = computeMidpoint(agg._max.position ?? null, null);

      const created = await tx.task.create({
        data: {
          projectId,
          key,
          title,
          description: description ? sanitizeRichText(description) : null,
          type,
          status: "TODO",
          priority,
          assigneeId: assigneeId ?? null,
          reporterId: user.id,
          parentId: parentId ?? null,
          position,
          dueDate: dueDate ?? null,
          ...(labelIds?.length
            ? { labels: { connect: labelIds.map((id) => ({ id })) } }
            : {}),
        },
        select: { id: true, key: true },
      });

      await tx.activityLog.create({
        data: { taskId: created.id, actorId: user.id, action: "created" },
      });

      return created;
    });

    if (assigneeId) {
      await notifyAssignee({
        taskId: task.id,
        assigneeId,
        actorId: user.id,
        actorName: user.name,
      });
    }

    revalidateProjectViews(projectId);
    return { ok: true, data: { id: task.id, key: task.key } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (err instanceof ActionError) return fail(err.message);
    if (isNotFound(err)) return fail("Project not found.");
    return fail("Something went wrong. Please try again.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateTask — project MEMBER+
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update the provided fields of a task, writing one ActivityLog row per CHANGED field.
 * Enum/date values are stringified into old/new; the description logs the field name
 * only (the HTML is too large and noisy to store as a diff value). A status change from
 * here re-homes the card at the bottom of the destination column (board drag ordering
 * lives in `moveTask`). Assignee/labels are same-project validated.
 */
export async function updateTask(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;

  try {
    const current = await prisma.task.findUnique({
      where: { id: data.taskId },
      select: {
        id: true,
        projectId: true,
        title: true,
        description: true,
        type: true,
        status: true,
        priority: true,
        assigneeId: true,
        dueDate: true,
        labels: { select: { id: true } },
      },
    });
    if (!current) return fail("Task not found.");

    const { user } = await requireProjectRole(current.projectId, "MEMBER");

    const updateData: Prisma.TaskUncheckedUpdateInput = {};
    const activities: {
      field: string;
      oldValue?: string | null;
      newValue?: string | null;
    }[] = [];
    let validateAssigneeId: string | null = null;
    let validateLabelIds: string[] | null = null;
    let statusChanged = false;

    if (data.title !== undefined && data.title !== current.title) {
      updateData.title = data.title;
      activities.push({ field: "title", oldValue: current.title, newValue: data.title });
    }
    if (data.type !== undefined && data.type !== current.type) {
      updateData.type = data.type;
      activities.push({ field: "type", oldValue: current.type, newValue: data.type });
    }
    if (data.priority !== undefined && data.priority !== current.priority) {
      updateData.priority = data.priority;
      activities.push({
        field: "priority",
        oldValue: current.priority,
        newValue: data.priority,
      });
    }
    if (data.status !== undefined && data.status !== current.status) {
      statusChanged = true;
      updateData.status = data.status;
      activities.push({
        field: "status",
        oldValue: current.status,
        newValue: data.status,
      });
    }
    if (
      data.assigneeId !== undefined &&
      (data.assigneeId ?? null) !== current.assigneeId
    ) {
      const next = data.assigneeId ?? null;
      updateData.assigneeId = next;
      activities.push({
        field: "assignee",
        oldValue: current.assigneeId,
        newValue: next,
      });
      validateAssigneeId = next; // null = unassign; membership check skipped below
    }
    if (data.dueDate !== undefined) {
      const nextDue = data.dueDate ?? null;
      const curIso = current.dueDate ? current.dueDate.toISOString() : null;
      const nextIso = nextDue ? nextDue.toISOString() : null;
      if (curIso !== nextIso) {
        updateData.dueDate = nextDue;
        activities.push({ field: "dueDate", oldValue: curIso, newValue: nextIso });
      }
    }
    if (data.description !== undefined) {
      const sanitized = data.description ? sanitizeRichText(data.description) : null;
      if (sanitized !== current.description) {
        updateData.description = sanitized;
        activities.push({ field: "description" }); // no values — HTML too large
      }
    }
    if (data.labelIds !== undefined) {
      const nextSet = new Set(data.labelIds);
      const curSet = new Set(current.labels.map((l) => l.id));
      const changed =
        nextSet.size !== curSet.size || [...nextSet].some((id) => !curSet.has(id));
      if (changed) {
        updateData.labels = { set: data.labelIds.map((id) => ({ id })) };
        activities.push({ field: "labels" });
        validateLabelIds = data.labelIds;
      }
    }

    if (activities.length === 0) {
      return { ok: true, data: { id: current.id } }; // nothing changed
    }

    await prisma.$transaction(async (tx) => {
      if (validateAssigneeId) {
        await assertProjectMember(tx, current.projectId, validateAssigneeId);
      }
      if (validateLabelIds) {
        await assertLabelsInProject(tx, current.projectId, validateLabelIds);
      }
      if (statusChanged) {
        const agg = await tx.task.aggregate({
          where: { projectId: current.projectId, status: data.status! },
          _max: { position: true },
        });
        updateData.position = computeMidpoint(agg._max.position ?? null, null);
      }

      await tx.task.update({ where: { id: current.id }, data: updateData });
      await tx.activityLog.createMany({
        data: activities.map((a) => ({
          taskId: current.id,
          actorId: user.id,
          action: "updated",
          field: a.field,
          oldValue: a.oldValue ?? null,
          newValue: a.newValue ?? null,
        })),
      });
    });

    // Reassigned to someone (not unassigned, not self) → notify them by email.
    if (validateAssigneeId) {
      await notifyAssignee({
        taskId: current.id,
        assigneeId: validateAssigneeId,
        actorId: user.id,
        actorName: user.name,
      });
    }

    revalidateProjectViews(current.projectId);
    return { ok: true, data: { id: current.id } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (err instanceof ActionError) return fail(err.message);
    return fail("Something went wrong. Please try again.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// moveTask — project MEMBER+ (board drag-and-drop)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reposition (and optionally re-status) a task from a board drag. The new position is
 * the fractional midpoint of the drop neighbours' positions — a single-row update in
 * the common case. If the neighbours are too close to bisect, the whole destination
 * column is re-spaced inside the transaction first, then the card is placed. A status
 * change writes a "moved" ActivityLog row.
 */
export async function moveTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { taskId, toStatus, beforeTaskId, afterTaskId } = parsed.data;

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true, status: true },
    });
    if (!task) return fail("Task not found.");

    const { user } = await requireProjectRole(task.projectId, "MEMBER");

    await prisma.$transaction(async (tx) => {
      // Resolve neighbour positions; both must be in the destination column & project.
      const neighbourIds = [beforeTaskId, afterTaskId].filter(
        (x): x is string => x !== null,
      );
      const neighbours = neighbourIds.length
        ? await tx.task.findMany({
            where: { id: { in: neighbourIds } },
            select: { id: true, projectId: true, status: true, position: true },
          })
        : [];
      const byId = new Map(neighbours.map((n) => [n.id, n]));

      const resolve = (nid: string | null): number | null => {
        if (!nid) return null;
        const n = byId.get(nid);
        if (!n || n.projectId !== task.projectId || n.status !== toStatus) {
          throw new ActionError("The board changed — please retry the move.");
        }
        return n.position;
      };
      const beforePos = resolve(beforeTaskId);
      const afterPos = resolve(afterTaskId);

      let position: number;
      if (needsRebalance(beforePos, afterPos)) {
        // Re-space the destination column (excluding the moved card), then re-insert.
        const column = await tx.task.findMany({
          where: {
            projectId: task.projectId,
            status: toStatus,
            parentId: null,
            id: { not: taskId },
          },
          orderBy: { position: "asc" },
          select: { id: true },
        });
        const spaced = rebalancedPositions(column.length);
        for (let i = 0; i < column.length; i++) {
          await tx.task.update({
            where: { id: column[i].id },
            data: { position: spaced[i] },
          });
        }
        const idxBefore = beforeTaskId
          ? column.findIndex((c) => c.id === beforeTaskId)
          : -1;
        const idxAfter = afterTaskId
          ? column.findIndex((c) => c.id === afterTaskId)
          : -1;
        position = computeMidpoint(
          idxBefore >= 0 ? spaced[idxBefore] : null,
          idxAfter >= 0 ? spaced[idxAfter] : null,
        );
      } else {
        position = computeMidpoint(beforePos, afterPos);
      }

      const statusChanged = task.status !== toStatus;
      await tx.task.update({
        where: { id: taskId },
        data: { position, status: toStatus },
      });
      if (statusChanged) {
        await tx.activityLog.create({
          data: {
            taskId,
            actorId: user.id,
            action: "moved",
            field: "status",
            oldValue: task.status,
            newValue: toStatus,
          },
        });
      }
    });

    revalidateProjectViews(task.projectId);
    return { ok: true, data: { id: taskId } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (err instanceof ActionError) return fail(err.message);
    return fail("Something went wrong. Please try again.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateTaskStatus — project MEMBER+ (inline quick-change)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convenience for inline status changes from the dashboard / backlog rows. Moves the
 * card to the bottom of the destination column and writes a "status_changed" ActivityLog
 * row. No-ops (returns ok) when the status is unchanged.
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateTaskStatusSchema.safeParse({ taskId, status });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  try {
    const task = await prisma.task.findUnique({
      where: { id: parsed.data.taskId },
      select: { id: true, projectId: true, status: true },
    });
    if (!task) return fail("Task not found.");

    const { user } = await requireProjectRole(task.projectId, "MEMBER");

    if (task.status === parsed.data.status) {
      return { ok: true, data: { id: task.id } };
    }

    await prisma.$transaction(async (tx) => {
      const agg = await tx.task.aggregate({
        where: { projectId: task.projectId, status: parsed.data.status },
        _max: { position: true },
      });
      const position = computeMidpoint(agg._max.position ?? null, null);
      await tx.task.update({
        where: { id: task.id },
        data: { status: parsed.data.status, position },
      });
      await tx.activityLog.create({
        data: {
          taskId: task.id,
          actorId: user.id,
          action: "status_changed",
          field: "status",
          oldValue: task.status,
          newValue: parsed.data.status,
        },
      });
    });

    revalidateProjectViews(task.projectId);
    return { ok: true, data: { id: task.id } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (err instanceof ActionError) return fail(err.message);
    return fail("Something went wrong. Please try again.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteTask — project MEMBER (own-reported only) / MANAGER (any)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete a task. A MEMBER may delete only tasks they reported; a MANAGER (and a global
 * Admin, effective MANAGER) may delete any task in the project.
 *
 * Subtasks are NOT deleted — they are orphaned to top-level (schema `parentId` SetNull),
 * which is the non-destructive choice, so ONLY this task's own attachment objects are
 * removed from R2 (subtasks keep theirs). The DB delete cascades comments, attachments,
 * and activity rows; R2 objects are deleted after, tolerating partial failure (failed
 * keys recorded in an AuditLog entry for orphan cleanup).
 */
export async function deleteTask(
  taskId: string,
): Promise<ActionResult<{ deletedR2: number; failedR2: number }>> {
  const parsed = deleteTaskSchema.safeParse({ taskId });
  if (!parsed.success) return fail("Invalid input");

  try {
    const task = await prisma.task.findUnique({
      where: { id: parsed.data.taskId },
      select: { id: true, projectId: true, reporterId: true, key: true },
    });
    if (!task) return fail("Task not found.");

    const { user, role } = await requireProjectRole(task.projectId, "MEMBER");
    if (role === "MEMBER" && task.reporterId !== user.id) {
      return fail("You can only delete tasks you reported.");
    }

    // Only this task's own attachments (subtasks survive and keep theirs).
    const attachments = await prisma.attachment.findMany({
      where: { taskId: task.id },
      select: { key: true },
    });
    const keys = attachments.map((a) => a.key);

    // Single atomic delete; cascades comments/attachments/activity, orphans subtasks.
    await prisma.task.delete({ where: { id: task.id } });

    const { deleted, failed } = await deleteObjects(keys);

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "task.deleted",
        targetType: "Task",
        targetId: task.id,
        metadata: {
          key: task.key,
          projectId: task.projectId,
          deletedR2: deleted.length,
          failedR2Keys: failed,
        },
      },
    });

    revalidateProjectViews(task.projectId);
    return { ok: true, data: { deletedR2: deleted.length, failedR2: failed.length } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (isNotFound(err)) return fail("Task not found.");
    return fail("Something went wrong. Please try again.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// searchTasksAndProjects — command palette (⌘K)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client-callable wrapper around `searchEverything` for the command palette.
 * Returns empty results (never throws) so a transient failure just shows
 * nothing rather than erroring the palette.
 */
export async function searchTasksAndProjects(
  query: string,
): Promise<SearchResults> {
  try {
    return await searchEverything(query);
  } catch {
    return { tasks: [], projects: [] };
  }
}
