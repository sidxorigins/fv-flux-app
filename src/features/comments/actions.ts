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
//   - react:  VIEWER+ on the comment's project. The reacting user is always the
//             SESSION user — never trust a userId from the client.

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  PROJECT_ROLE_ORDER,
  requireProjectRole,
} from "@/lib/permissions";
import { sanitizeCommentBody } from "@/lib/sanitize";
import { deleteObjects } from "@/lib/r2";
import {
  ensureWatching,
  getTaskAudience,
  notify,
} from "@/features/notifications/service";
import { notifyMentions } from "@/features/notifications/mentions";

import {
  addCommentSchema,
  deleteCommentSchema,
  reactionSchema,
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

/**
 * Validate that every id in `attachmentIds` is a draft upload safe to link to a
 * comment on `taskId` by `userId`: it must exist, belong to this task, still be
 * unlinked (`commentId` null), and be the caller's own upload. Returns the id
 * list on success, or `null` if ANY id fails (all-or-nothing — a mismatch means
 * a stale/crafted client, so we reject rather than silently drop).
 */
async function validateDraftAttachments(
  attachmentIds: string[],
  taskId: string,
  userId: string,
): Promise<string[] | null> {
  if (attachmentIds.length === 0) return [];
  const unique = [...new Set(attachmentIds)];
  const rows = await prisma.attachment.findMany({
    where: { id: { in: unique } },
    select: { id: true, taskId: true, commentId: true, uploaderId: true },
  });
  const valid = rows.filter(
    (a) => a.taskId === taskId && a.commentId === null && a.uploaderId === userId,
  );
  return valid.length === unique.length ? unique : null;
}

export async function addComment(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = addCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { taskId, body, attachmentIds } = parsed.data;

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) return { ok: false, error: "Task not found." };

    const { user } = await requireProjectRole(task.projectId, "MEMBER");

    // Validate the draft uploads being attached: each must belong to this task,
    // still be an unlinked draft, and be the caller's own upload.
    const linkedIds = await validateDraftAttachments(
      attachmentIds,
      taskId,
      user.id,
    );
    if (linkedIds === null) {
      return { ok: false, error: "Some attachments are no longer available." };
    }

    // Sanitise BEFORE persisting; only inline images among the linked set survive.
    const clean = sanitizeCommentBody(body, linkedIds);
    // A comment must carry SOMETHING — text/images in the body, or a file.
    if (isRichTextEmpty(clean) && linkedIds.length === 0) {
      return { ok: false, error: "Comment can't be empty." };
    }

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: { taskId, authorId: user.id, body: clean },
      });
      if (linkedIds.length > 0) {
        // Re-guard the draft conditions in the WHERE so a concurrent link can't slip through.
        await tx.attachment.updateMany({
          where: { id: { in: linkedIds }, commentId: null, uploaderId: user.id, taskId },
          data: { commentId: created.id },
        });
      }
      await tx.activityLog.create({
        data: { taskId, actorId: user.id, action: "commented" },
      });
      return created;
    });

    // The commenter now follows the task. Notify everyone else following it,
    // then anyone @mentioned in the comment (a mention wins over a plain
    // "commented" notice — notifyMentions excludes those already mentioned).
    await ensureWatching(taskId, user.id);
    const mentioned = await notifyMentions({
      taskId,
      projectId: task.projectId,
      actorId: user.id,
      html: clean,
    });
    const audience = await getTaskAudience(taskId);
    await notify({
      recipientIds: audience.filter((id) => !mentioned.includes(id)),
      actorId: user.id,
      type: "TASK_COMMENTED",
      taskId,
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
  const { commentId, body, attachmentIds } = parsed.data;

  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        authorId: true,
        taskId: true,
        task: { select: { projectId: true } },
        attachments: { select: { id: true, key: true } },
      },
    });
    if (!comment) return { ok: false, error: "Comment not found." };

    // Editing is a content mutation → require MEMBER+ project access...
    const { user } = await requireProjectRole(comment.task.projectId, "MEMBER");
    // ...AND strict authorship. Managers/Admins cannot edit others' words.
    if (comment.authorId !== user.id) {
      return { ok: false, error: "You can only edit your own comments." };
    }

    // Reconcile the desired attachment set against what's currently linked:
    //  - ids already on THIS comment → keep.
    //  - ids that are the caller's unlinked drafts on this task → link.
    //  - anything else in the request → reject (stale/crafted).
    //  - currently-linked ids NOT in the request → remove (row + R2 object).
    const currentIds = new Set(comment.attachments.map((a) => a.id));
    const requested = new Set(attachmentIds);
    const toLinkCandidates = attachmentIds.filter((id) => !currentIds.has(id));
    const newDraftIds = await validateDraftAttachments(
      toLinkCandidates,
      comment.taskId,
      user.id,
    );
    if (newDraftIds === null) {
      return { ok: false, error: "Some attachments are no longer available." };
    }
    const removed = comment.attachments.filter((a) => !requested.has(a.id));
    const finalIds = [
      ...comment.attachments.filter((a) => requested.has(a.id)).map((a) => a.id),
      ...newDraftIds,
    ];

    const clean = sanitizeCommentBody(body, finalIds);
    if (isRichTextEmpty(clean) && finalIds.length === 0) {
      return { ok: false, error: "Comment can't be empty." };
    }

    await prisma.$transaction(async (tx) => {
      // `updatedAt` is bumped automatically by Prisma's @updatedAt on any write.
      await tx.comment.update({ where: { id: commentId }, data: { body: clean } });
      if (newDraftIds.length > 0) {
        await tx.attachment.updateMany({
          where: {
            id: { in: newDraftIds },
            commentId: null,
            uploaderId: user.id,
            taskId: comment.taskId,
          },
          data: { commentId },
        });
      }
      if (removed.length > 0) {
        await tx.attachment.deleteMany({
          where: { id: { in: removed.map((a) => a.id) }, commentId },
        });
      }
    });

    // Delete the R2 objects for removed attachments AFTER the row delete commits.
    if (removed.length > 0) {
      const result = await deleteObjects(removed.map((a) => a.key));
      if (result.failed.length > 0) {
        await prisma.auditLog.create({
          data: {
            actorId: user.id,
            action: "attachment.r2_delete_failed",
            targetType: "Comment",
            targetId: commentId,
            metadata: { keys: result.failed },
          },
        });
      }
    }

    revalidate();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

/**
 * Toggle the SESSION user's reaction (an emoji) on a comment: creates it if not
 * yet present, deletes it if it is. `emoji` is stored as opaque text — never
 * validated against an allowlist here, since the presentation layer owns the
 * emoji picker. `userId` is always the resolved session user, never taken from
 * the input, so a caller cannot react on another user's behalf.
 */
export async function toggleCommentReaction(
  input: unknown,
): Promise<ActionResult<{ reacted: boolean }>> {
  const parsed = reactionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { commentId, emoji } = parsed.data;

  try {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { task: { select: { projectId: true } } },
    });
    if (!comment) return { ok: false, error: "Comment not found." };

    // VIEWER+ establishes project access — reacting doesn't require MEMBER.
    const { user } = await requireProjectRole(comment.task.projectId, "VIEWER");

    const existing = await prisma.commentReaction.findUnique({
      where: {
        commentId_userId_emoji: { commentId, userId: user.id, emoji },
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.commentReaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.commentReaction.create({
        data: { commentId, userId: user.id, emoji },
      });
    }

    revalidate();
    return { ok: true, data: { reacted: !existing } };
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
        attachments: { select: { key: true } },
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

    // Collect R2 keys BEFORE the delete cascade removes the attachment rows.
    const keys = comment.attachments.map((a) => a.key);

    await prisma.$transaction(async (tx) => {
      // Deleting the comment cascades its Attachment rows (schema onDelete).
      await tx.comment.delete({ where: { id: commentId } });
      await tx.activityLog.create({
        data: {
          taskId: comment.task.id,
          actorId: user.id,
          action: "comment_deleted",
        },
      });
    });

    // Then the object store — tolerate partial failure with an audit breadcrumb.
    if (keys.length > 0) {
      const result = await deleteObjects(keys);
      if (result.failed.length > 0) {
        await prisma.auditLog.create({
          data: {
            actorId: user.id,
            action: "attachment.r2_delete_failed",
            targetType: "Comment",
            targetId: commentId,
            metadata: { keys: result.failed },
          },
        });
      }
    }

    revalidate();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
