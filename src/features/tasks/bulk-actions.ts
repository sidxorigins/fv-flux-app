"use server";

// Bulk task Server Actions — multi-select operations from the backlog toolbar.
// Same shape as features/tasks/actions.ts (Zod-validate → permission helper from
// lib/permissions → writes in a transaction → revalidate → `{ ok }` ActionResult),
// kept in a sibling module rather than added to actions.ts.
//
// Both actions resolve the project from the selected task ids and REQUIRE a single
// project across the whole selection — a mixed-project selection is rejected
// outright rather than partially applied (the backlog itself is always scoped to
// one project, so this should never legitimately happen from the UI, but the
// server never trusts the client's selection).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { deleteObjects } from "@/lib/r2";
import { AuthorizationError, requireProjectRole } from "@/lib/permissions";
import { TaskStatus } from "@/generated/prisma/enums";
import { z } from "zod";

import { computeMidpoint } from "./positioning";

// Mirrors the `{ ok }` ActionResult union from ./actions — duplicated locally
// (rather than imported) so this module stays a fully self-contained "use
// server" file, same reasoning BacklogView.tsx documents for redeclaring
// BACKLOG_SORT_FIELDS instead of importing the value cross-module.
export type ActionResult<T = undefined> =
  { ok: true; data?: T } | { ok: false; error: string };

/** Thrown to abort a bulk op with a specific user-facing message. */
class ActionError extends Error {}

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

function revalidateProjectViews(projectId: string): void {
  revalidatePath("/dashboard");
  // "layout" revalidates every nested route under the project (board, backlog, tasks).
  revalidatePath(`/projects/${projectId}`, "layout");
}

const bulkTaskIdsSchema = z.object({
  taskIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one task.")
    .max(500, "Too many tasks selected."),
});

const bulkUpdateStatusSchema = bulkTaskIdsSchema.extend({
  status: z.enum(TaskStatus),
});

/**
 * Load the selected tasks and resolve the single project they all belong to.
 * Throws ActionError for an unknown id or a selection spanning more than one
 * project — bulk ops never partially apply across projects.
 */
async function loadTasksInSameProject(taskIds: string[]) {
  const unique = [...new Set(taskIds)];
  const tasks = await prisma.task.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      projectId: true,
      status: true,
      reporterId: true,
      key: true,
    },
  });
  if (tasks.length !== unique.length) {
    throw new ActionError("One or more tasks were not found.");
  }
  const projectIds = new Set(tasks.map((t) => t.projectId));
  if (projectIds.size > 1) {
    throw new ActionError(
      "Selected tasks must all belong to the same project.",
    );
  }
  return { projectId: tasks[0].projectId, tasks };
}

// ─────────────────────────────────────────────────────────────────────────────
// bulkUpdateTaskStatus — project MEMBER+
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the status on many tasks at once. Mirrors `updateTaskStatus`'s single-task
 * behaviour: each changed task moves to the bottom of the destination column
 * (positions computed as successive midpoints so the whole batch is one
 * transaction, no per-task rebalance query) and a "status_changed" ActivityLog
 * row is written per task. Tasks already at the target status are left alone
 * and don't count towards the returned total.
 */
export async function bulkUpdateTaskStatus(
  taskIds: string[],
  status: TaskStatus,
): Promise<ActionResult<{ count: number }>> {
  const parsed = bulkUpdateStatusSchema.safeParse({ taskIds, status });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  try {
    const { projectId, tasks } = await loadTasksInSameProject(
      parsed.data.taskIds,
    );
    const { user } = await requireProjectRole(projectId, "MEMBER");

    const toChange = tasks.filter((t) => t.status !== parsed.data.status);
    if (toChange.length === 0) {
      return { ok: true, data: { count: 0 } };
    }

    await prisma.$transaction(async (tx) => {
      const agg = await tx.task.aggregate({
        where: { projectId, status: parsed.data.status },
        _max: { position: true },
      });
      let position: number | null = agg._max.position ?? null;

      for (const task of toChange) {
        position = computeMidpoint(position, null);
        await tx.task.update({
          where: { id: task.id },
          data: { status: parsed.data.status, position },
        });
      }

      await tx.activityLog.createMany({
        data: toChange.map((task) => ({
          taskId: task.id,
          actorId: user.id,
          action: "status_changed",
          field: "status",
          oldValue: task.status,
          newValue: parsed.data.status,
        })),
      });
    });

    revalidateProjectViews(projectId);
    return { ok: true, data: { count: toChange.length } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (err instanceof ActionError) return fail(err.message);
    return fail("Something went wrong. Please try again.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// bulkDeleteTasks — project MEMBER (own-reported only, ALL selected) / MANAGER (any)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete many tasks at once. Same authorisation rule as the single-task
 * `deleteTask`: a MEMBER may delete only tasks they reported — for a bulk
 * selection that means EVERY selected task must be theirs, or the whole
 * operation is rejected (no silent partial delete). MANAGER (and a global
 * Admin, effective MANAGER) may delete any task in the project.
 *
 * Subtasks are NOT deleted — orphaned to top-level (schema `parentId` SetNull),
 * so only each deleted task's own attachment objects are removed from R2. The
 * DB delete cascades comments/attachments/activity rows per task; R2 objects
 * are deleted after, tolerating partial failure (one AuditLog row per task,
 * same "task.deleted" action as the single-task delete, recording the batch's
 * R2 outcome for orphan cleanup).
 */
export async function bulkDeleteTasks(
  taskIds: string[],
): Promise<
  ActionResult<{ deletedTasks: number; deletedR2: number; failedR2: number }>
> {
  const parsed = bulkTaskIdsSchema.safeParse({ taskIds });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  try {
    const { projectId, tasks } = await loadTasksInSameProject(
      parsed.data.taskIds,
    );
    const { user, role } = await requireProjectRole(projectId, "MEMBER");
    if (role === "MEMBER" && tasks.some((t) => t.reporterId !== user.id)) {
      return fail("You can only delete tasks you reported.");
    }

    const ids = tasks.map((t) => t.id);

    // Only these tasks' own attachments (subtasks survive and keep theirs).
    const attachments = await prisma.attachment.findMany({
      where: { taskId: { in: ids } },
      select: { key: true },
    });
    const keys = attachments.map((a) => a.key);

    // Single atomic delete; cascades comments/attachments/activity per task,
    // orphans subtasks.
    await prisma.$transaction(async (tx) => {
      await tx.task.deleteMany({ where: { id: { in: ids } } });
    });

    const { deleted, failed } = await deleteObjects(keys);

    // One row per task, mirroring deleteTask's single-task audit entry. The
    // R2 counts are the whole batch's outcome (attachments aren't dropped one
    // key at a time), not a per-task breakdown.
    await prisma.auditLog.createMany({
      data: tasks.map((task) => ({
        actorId: user.id,
        action: "task.deleted",
        targetType: "Task",
        targetId: task.id,
        metadata: {
          key: task.key,
          projectId,
          bulk: true,
          batchDeletedR2: deleted.length,
          batchFailedR2Keys: failed,
        },
      })),
    });

    revalidateProjectViews(projectId);
    return {
      ok: true,
      data: {
        deletedTasks: tasks.length,
        deletedR2: deleted.length,
        failedR2: failed.length,
      },
    };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (err instanceof ActionError) return fail(err.message);
    return fail("Something went wrong. Please try again.");
  }
}
