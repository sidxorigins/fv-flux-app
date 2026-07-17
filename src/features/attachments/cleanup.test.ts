// Guards the orphan-draft sweep against the trap that task-level attachments are
// ALSO commentId-null: the query MUST additionally require a `/comments/` key so
// it never deletes a task attachment. Also checks rows are deleted before objects.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

const { deleteObjects } = vi.hoisted(() => ({
  deleteObjects: vi.fn(async () => ({ deleted: ["k"], failed: [] })),
}));
vi.mock("@/lib/r2", () => ({ deleteObjects }));

vi.mock("@/lib/db", () => {
  const attachment = {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  };
  return { prisma: { attachment } };
});

import { prisma } from "@/lib/db";
import { sweepOrphanDraftAttachments } from "./cleanup";

const db = prisma as unknown as {
  attachment: { findMany: Mock; deleteMany: Mock };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.attachment.deleteMany.mockResolvedValue({ count: 1 });
});

describe("sweepOrphanDraftAttachments", () => {
  it("queries only commentId-null drafts with a /comments/ key older than the TTL", async () => {
    db.attachment.findMany.mockResolvedValue([{ id: "a1", key: "tasks/t/comments/u/x.png" }]);

    await sweepOrphanDraftAttachments(new Date("2026-07-17T00:00:00Z"));

    const where = db.attachment.findMany.mock.calls[0][0].where;
    expect(where.commentId).toBeNull();
    expect(where.key).toEqual({ contains: "/comments/" });
    // 24h before the passed "now".
    expect(where.createdAt.lt).toEqual(new Date("2026-07-16T00:00:00Z"));
  });

  it("deletes rows then R2 objects, returning counts", async () => {
    db.attachment.findMany.mockResolvedValue([
      { id: "a1", key: "tasks/t/comments/u/x.png" },
    ]);

    const res = await sweepOrphanDraftAttachments();

    expect(db.attachment.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1"] } },
    });
    expect(deleteObjects).toHaveBeenCalledWith(["tasks/t/comments/u/x.png"]);
    expect(res).toEqual({ deletedRows: 1, deletedObjects: 1, failedObjects: 0 });
  });

  it("does nothing (no R2 call) when there are no drafts", async () => {
    db.attachment.findMany.mockResolvedValue([]);
    const res = await sweepOrphanDraftAttachments();
    expect(db.attachment.deleteMany).not.toHaveBeenCalled();
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(res).toEqual({ deletedRows: 0, deletedObjects: 0, failedObjects: 0 });
  });
});
