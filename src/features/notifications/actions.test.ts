// addTaskWatcher / removeTaskWatcher permission + behaviour. Mocks mirror
// comments/actions.test.ts: @/lib/db is a hand-rolled prisma mock; permissions
// and the notify side-effect are stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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
    requireUser: vi.fn(),
    getProjectRole: vi.fn(),
  };
});

vi.mock("@/features/notifications/service", () => ({ notify: vi.fn() }));

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    task: model(),
    taskWatcher: model(),
    activityLog: model(),
    user: model(),
  };
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireProjectRole, getProjectRole } from "@/lib/permissions";
import { notify } from "@/features/notifications/service";
import { addTaskWatcher, removeTaskWatcher } from "./actions";

interface MockModel { findUnique: Mock; upsert: Mock; delete: Mock; create: Mock }
const db = prisma as unknown as {
  task: MockModel; taskWatcher: MockModel; activityLog: MockModel; user: MockModel;
};
const mockRPR = requireProjectRole as unknown as Mock;
const mockGPR = getProjectRole as unknown as Mock;
const mockNotify = notify as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findUnique.mockResolvedValue({ projectId: "p1" });
  db.user.findUnique.mockResolvedValue({ name: "Jane Doe" });
  db.taskWatcher.findUnique.mockResolvedValue({ id: "w1" });
  db.taskWatcher.upsert.mockResolvedValue({});
  db.taskWatcher.delete.mockResolvedValue({});
  db.activityLog.create.mockResolvedValue({});
});

describe("addTaskWatcher", () => {
  it("adds a project member as watcher (MEMBER+)", async () => {
    db.taskWatcher.findUnique.mockResolvedValueOnce(null); // treat as a brand-new watcher
    mockRPR.mockResolvedValue({ user: { id: "u-actor" }, role: "MEMBER" });
    mockGPR.mockResolvedValue("MEMBER"); // target is a member
    const res = await addTaskWatcher({ taskId: "t1", userId: "u-target" });
    expect(res).toEqual({ ok: true, data: { added: true } });
    expect(db.taskWatcher.upsert).toHaveBeenCalledOnce();
    expect(db.activityLog.create).toHaveBeenCalledOnce();
    expect(db.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "watcher_added",
          field: "watcher",
          newValue: "Jane Doe",
        }),
      }),
    );
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "TASK_WATCHER_ADDED",
        recipientIds: ["u-target"],
        taskId: "t1",
      }),
    );
  });

  it("rejects a non-member target", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u-actor" }, role: "MEMBER" });
    mockGPR.mockResolvedValue(null); // target has no membership
    const res = await addTaskWatcher({ taskId: "t1", userId: "u-outsider" });
    expect(res.ok).toBe(false);
    expect(db.taskWatcher.upsert).not.toHaveBeenCalled();
  });

  it("propagates FORBIDDEN for a VIEWER", async () => {
    const { AuthorizationError } = await import("@/lib/permissions");
    mockRPR.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    const res = await addTaskWatcher({ taskId: "t1", userId: "u-target" });
    expect(res).toEqual({ ok: false, error: "You don't have permission to do that." });
  });

  it("does not re-log or re-notify when already watching", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u-actor" }, role: "MEMBER" });
    mockGPR.mockResolvedValue("MEMBER"); // target is a member
    // db.taskWatcher.findUnique keeps the default { id: "w1" } → already watching
    const res = await addTaskWatcher({ taskId: "t1", userId: "u-target" });
    expect(res).toEqual({ ok: true, data: { added: false } });
    expect(db.activityLog.create).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("removeTaskWatcher", () => {
  it("lets a VIEWER remove themselves", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u-self" }, role: "VIEWER" });
    const res = await removeTaskWatcher({ taskId: "t1", userId: "u-self" });
    expect(res).toEqual({ ok: true, data: { removed: true } });
    expect(db.taskWatcher.delete).toHaveBeenCalledOnce();
    expect(db.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "watcher_removed",
          field: "watcher",
          oldValue: "Jane Doe",
        }),
      }),
    );
  });

  it("forbids a VIEWER removing someone else", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u-self" }, role: "VIEWER" });
    const res = await removeTaskWatcher({ taskId: "t1", userId: "u-other" });
    expect(res.ok).toBe(false);
    expect(db.taskWatcher.delete).not.toHaveBeenCalled();
  });
});
