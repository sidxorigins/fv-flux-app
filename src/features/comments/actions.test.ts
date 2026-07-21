// Focused tests for the attachment-linking rules added to addComment: which
// draft uploads may be linked, that an attachment-only comment is allowed, that
// an empty comment with no attachments is rejected, and that unlinked/foreign
// inline images are stripped from the stored body (defense-in-depth alongside the
// sanitiser's own /api/files check).
//
// Mocking mirrors tasks/actions.test.ts: @/lib/db is a hand-rolled mock whose
// `prisma.x` and the `tx` in `$transaction` are the SAME object; permissions,
// r2, and the notifications side-effects are stubbed. The REAL sanitiser + text
// helpers run so the img-stripping assertions exercise production behaviour.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/r2", () => ({ deleteObjects: vi.fn(async () => ({ deleted: [], failed: [] })) }));

vi.mock("@/lib/permissions", () => {
  class AuthorizationError extends Error {
    readonly code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthorizationError";
      this.code = code;
    }
  }
  return {
    AuthorizationError,
    PROJECT_ROLE_ORDER: { VIEWER: 0, MEMBER: 1, MANAGER: 2 },
    requireProjectRole: vi.fn(),
  };
});

vi.mock("@/features/notifications/service", () => ({
  ensureWatching: vi.fn(),
  getTaskAudience: vi.fn(async () => []),
  notify: vi.fn(),
}));
vi.mock("@/features/notifications/mentions", () => ({
  notifyMentions: vi.fn(async () => []),
}));

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    delete: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    task: model(),
    comment: model(),
    commentReaction: model(),
    attachment: model(),
    activityLog: model(),
    auditLog: model(),
  };
  prisma.$transaction = vi.fn();
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireProjectRole } from "@/lib/permissions";
import { addComment, toggleCommentReaction } from "./actions";

interface MockModel {
  findUnique: Mock;
  findMany: Mock;
  create: Mock;
  updateMany: Mock;
  deleteMany: Mock;
  delete: Mock;
}
const db = prisma as unknown as {
  task: MockModel;
  comment: MockModel;
  commentReaction: MockModel;
  attachment: MockModel;
  activityLog: MockModel;
  $transaction: Mock;
};
const mockRequireProjectRole = requireProjectRole as unknown as Mock;

const USER = { id: "u1" };
const TASK_ID = "t1";
const PROJECT_ID = "p1";

function draft(id: string, over: Partial<Record<string, unknown>> = {}) {
  return { id, taskId: TASK_ID, commentId: null, uploaderId: USER.id, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db));
  db.task.findUnique.mockResolvedValue({ projectId: PROJECT_ID });
  mockRequireProjectRole.mockResolvedValue({ user: USER, role: "MEMBER" });
  db.comment.create.mockResolvedValue({ id: "c1" });
  db.attachment.updateMany.mockResolvedValue({ count: 1 });
  db.activityLog.create.mockResolvedValue({});
});

describe("addComment — attachment linking", () => {
  it("links a valid draft and stores the comment", async () => {
    db.attachment.findMany.mockResolvedValue([draft("a1")]);

    const res = await addComment({
      taskId: TASK_ID,
      body: "<p>hello</p>",
      attachmentIds: ["a1"],
    });

    expect(res.ok).toBe(true);
    expect(db.attachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["a1"] },
          commentId: null,
          uploaderId: USER.id,
          taskId: TASK_ID,
        }),
        data: { commentId: "c1" },
      }),
    );
  });

  it("rejects a foreign-task attachment", async () => {
    db.attachment.findMany.mockResolvedValue([draft("a1", { taskId: "other" })]);
    const res = await addComment({
      taskId: TASK_ID,
      body: "<p>hi</p>",
      attachmentIds: ["a1"],
    });
    expect(res.ok).toBe(false);
    expect(db.comment.create).not.toHaveBeenCalled();
  });

  it("rejects another user's draft", async () => {
    db.attachment.findMany.mockResolvedValue([draft("a1", { uploaderId: "u2" })]);
    const res = await addComment({
      taskId: TASK_ID,
      body: "<p>hi</p>",
      attachmentIds: ["a1"],
    });
    expect(res.ok).toBe(false);
    expect(db.comment.create).not.toHaveBeenCalled();
  });

  it("rejects an already-linked attachment", async () => {
    db.attachment.findMany.mockResolvedValue([draft("a1", { commentId: "cX" })]);
    const res = await addComment({
      taskId: TASK_ID,
      body: "<p>hi</p>",
      attachmentIds: ["a1"],
    });
    expect(res.ok).toBe(false);
    expect(db.comment.create).not.toHaveBeenCalled();
  });

  it("allows an attachment-only comment (empty body)", async () => {
    db.attachment.findMany.mockResolvedValue([draft("a1")]);
    const res = await addComment({
      taskId: TASK_ID,
      body: "<p></p>",
      attachmentIds: ["a1"],
    });
    expect(res.ok).toBe(true);
    expect(db.comment.create).toHaveBeenCalled();
  });

  it("rejects an empty comment with no attachments", async () => {
    const res = await addComment({
      taskId: TASK_ID,
      body: "<p></p>",
      attachmentIds: [],
    });
    expect(res.ok).toBe(false);
    expect(db.comment.create).not.toHaveBeenCalled();
  });

  it("strips an inline image whose id is not in the linked set", async () => {
    db.attachment.findMany.mockResolvedValue([draft("a1")]);
    await addComment({
      taskId: TASK_ID,
      body: '<p>see <img src="/api/files/EVIL"></p>',
      attachmentIds: ["a1"],
    });
    const created = db.comment.create.mock.calls[0][0];
    expect(created.data.body).not.toContain("EVIL");
    expect(created.data.body).toContain("see");
  });

  it("keeps an inline image whose id IS linked", async () => {
    db.attachment.findMany.mockResolvedValue([draft("img1")]);
    await addComment({
      taskId: TASK_ID,
      body: '<p><img src="/api/files/img1"></p>',
      attachmentIds: ["img1"],
    });
    const created = db.comment.create.mock.calls[0][0];
    expect(created.data.body).toContain("/api/files/img1");
  });
});

describe("toggleCommentReaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireProjectRole.mockResolvedValue({ user: { id: "u1" }, role: "VIEWER" });
    db.comment.findUnique.mockResolvedValue({ task: { projectId: "p1" } });
  });

  it("creates the reaction on first toggle (VIEWER allowed)", async () => {
    db.commentReaction.findUnique.mockResolvedValue(null);
    db.commentReaction.create.mockResolvedValue({});
    const res = await toggleCommentReaction({ commentId: "c1", emoji: "👍" });
    expect(res).toEqual({ ok: true, data: { reacted: true } });
    expect(db.commentReaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { commentId: "c1", userId: "u1", emoji: "👍" } }),
    );
  });

  it("removes the reaction on repeat toggle", async () => {
    db.commentReaction.findUnique.mockResolvedValue({ id: "r1" });
    db.commentReaction.delete.mockResolvedValue({});
    const res = await toggleCommentReaction({ commentId: "c1", emoji: "👍" });
    expect(res).toEqual({ ok: true, data: { reacted: false } });
    expect(db.commentReaction.delete).toHaveBeenCalledOnce();
  });

  it("rejects a caller without project access", async () => {
    const { AuthorizationError } = await import("@/lib/permissions");
    mockRequireProjectRole.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    const res = await toggleCommentReaction({ commentId: "c1", emoji: "👍" });
    expect(res.ok).toBe(false);
    expect(db.commentReaction.create).not.toHaveBeenCalled();
  });

  it("rejects an over-length emoji (schema cap)", async () => {
    const res = await toggleCommentReaction({ commentId: "c1", emoji: "x".repeat(33) });
    expect(res.ok).toBe(false);
    expect(db.commentReaction.create).not.toHaveBeenCalled();
  });
});
