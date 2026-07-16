"use server";

// Comment Server Actions. Convention: every action validates with a Zod schema,
// resolves the task's project and re-checks authorisation on the server, and
// returns a discriminated `{ ok }` union. Authorisation is NEVER trusted from
// the client — see lib/permissions.
//
// Authorisation rules (enforced here, mirrored — not replaced — by hidden UI):
//   - add:    MEMBER+ on the comment's project.
//   - update: AUTHOR ONLY. A project MANAGER (or global Admin) must NOT be able
//             to edit another user's words, so there is no role escape hatch —
//             the check is strictly `comment.authorId === user.id`. Editing is a
//             content mutation, so the actor must also still hold MEMBER+.
//   - delete: AUTHOR or project MANAGER (global Admin resolves to MANAGER via the
//             admin-bypass policy in lib/permissions).

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  PROJECT_ROLE_ORDER,
  requireProjectRole,
} from "@/lib/permissions";
import { sanitizeRichText } from "@/lib/sanitize";

import {
  addCommentSchema,
  deleteCommentSchema,
  updateCommentSchema,
} from "./schemas";
import { isRichTextEmpty } from "./text";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Map an authorisation failure (or unknown error) to a safe user-facing result. */
function toError(err: unknown): { ok: false; error: string } {
  if (err instanceof AuthorizationError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return { ok: false, error: "You need to sign in." };
      case "SUSPENDED":
        return { ok: false, error: "Your account has been suspended." };
      default:
        return { ok: false, error: "You don't have permission to do that." };
    }
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

/**
 * Comment/attachment data surfaces on the dashboard (activity feed, counts) and
 * inside the task drawer (client-refreshed via `router.refresh()`). We revalidate
 * the dashboard here; the drawer's own refresh handles the open panel.
 */
function revalidate(): void {
  revalidatePath("/dashboard");
}

export async function addComment(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = addCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { taskId, body } = parsed.data;

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) return { ok: false, error: "Task not found." };

    const { user } = await requireProjectRole(task.projectId, "MEMBER");

    // Sanitise BEFORE persisting, then reject if nothing meaningful survived.
    const clean = sanitizeRichText(body);
    if (isRichTextEmpty(clean)) {
      return { ok: false, error: "Comment can't be empty." };
    }

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: { taskId, authorId: user.id, body: clean },
      });
      await tx.activityLog.create({
        data: { taskId, actorId: user.id, action: "commented" },
      });
      return created;
    });

    revalidate();
    return { ok: true, data: { id: comment.id } };
  } catch (err) {
    return toError(err);
  }
}

export async function updateComment(input: unknown): Promise<ActionResult> {
  const parsed = updateCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { commentId, body } = parsed.data;

  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { authorId: true, task: { select: { projectId: true } } },
    });
    if (!comment) return { ok: false, error: "Comment not found." };

    // Editing is a content mutation → require MEMBER+ project access...
    const { user } = await requireProjectRole(comment.task.projectId, "MEMBER");
    // ...AND strict authorship. Managers/Admins cannot edit others' words.
    if (comment.authorId !== user.id) {
      return { ok: false, error: "You can only edit your own comments." };
    }

    const clean = sanitizeRichText(body);
    if (isRichTextEmpty(clean)) {
      return { ok: false, error: "Comment can't be empty." };
    }

    // `updatedAt` is bumped automatically by Prisma's @updatedAt on any write.
    await prisma.comment.update({
      where: { id: commentId },
      data: { body: clean },
    });

    revalidate();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deleteComment(input: unknown): Promise<ActionResult> {
  const parsed = deleteCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { commentId } = parsed.data;

  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        authorId: true,
        task: { select: { id: true, projectId: true } },
      },
    });
    if (!comment) return { ok: false, error: "Comment not found." };

    // VIEWER+ establishes project access; global Admin resolves to MANAGER.
    const { user, role } = await requireProjectRole(
      comment.task.projectId,
      "VIEWER",
    );
    const isAuthor = comment.authorId === user.id;
    const isManager = PROJECT_ROLE_ORDER[role] >= PROJECT_ROLE_ORDER.MANAGER;
    if (!isAuthor && !isManager) {
      return {
        ok: false,
        error: "You don't have permission to delete this comment.",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.comment.delete({ where: { id: commentId } });
      await tx.activityLog.create({
        data: {
          taskId: comment.task.id,
          actorId: user.id,
          action: "comment_deleted",
        },
      });
    });

    revalidate();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
