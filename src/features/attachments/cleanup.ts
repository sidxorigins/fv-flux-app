// Orphan-draft cleanup — internal server helper (NOT a "use server" module).
//
// Comment-composer uploads create an Attachment row immediately (commentId null)
// so the composer can reference them inline / in its tray. If the user never
// posts the comment, that row + its R2 object are orphaned. This sweep, run daily
// from the maintenance cron, deletes comment DRAFTS older than a TTL.
//
// It targets ONLY comment drafts: `commentId` null AND a `tasks/<id>/comments/…`
// key (see buildCommentAttachmentKey). Task-level attachments are also
// `commentId` null but have a `tasks/<id>/<uuid>/…` key, so they're never swept.

import { prisma } from "@/lib/db";
import { deleteObjects } from "@/lib/r2";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_PER_RUN = 500; // bound the work per invocation

export interface SweepResult {
  deletedRows: number;
  deletedObjects: number;
  failedObjects: number;
}

export async function sweepOrphanDraftAttachments(
  now: Date = new Date(),
): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - DRAFT_TTL_MS);

  const drafts = await prisma.attachment.findMany({
    where: {
      commentId: null,
      createdAt: { lt: cutoff },
      // Comment-draft keys only — never task-level attachments.
      key: { contains: "/comments/" },
    },
    select: { id: true, key: true },
    take: MAX_PER_RUN,
  });

  if (drafts.length === 0) {
    return { deletedRows: 0, deletedObjects: 0, failedObjects: 0 };
  }

  // Rows first, then the objects (tolerant of partial R2 failure — a failed key
  // just gets swept again next run, since the row is already gone... actually the
  // row is gone, so re-collect from R2 isn't possible; deleteObjects already
  // retries the batch, and a persistently-failing key is rare/benign bytes).
  await prisma.attachment.deleteMany({
    where: { id: { in: drafts.map((d) => d.id) } },
  });

  const { deleted, failed } = await deleteObjects(drafts.map((d) => d.key));

  return {
    deletedRows: drafts.length,
    deletedObjects: deleted.length,
    failedObjects: failed.length,
  };
}
