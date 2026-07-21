// Focused tests for the two pieces of tasks/actions.ts called out in the working
// agreement as "most likely to break silently": task-key generation (createTask)
// and the before/after neighbour resolution that moveTask hands off to the
// positioning helpers. The exhaustive arithmetic for computeMidpoint /
// needsRebalance / rebalancedPositions is covered in ./positioning.test.ts — the
// rebalance test below only confirms moveTask *wires them up* correctly, it does
// not re-verify the math.
//
// Mocking approach: @/lib/db is a hand-rolled mock exposing the handful of model
// methods actions.ts actually calls (both `prisma.x` and the `tx` passed into
// `$transaction` are the SAME mock object, since our fake `$transaction` just
// invokes the callback with it). @/lib/permissions is mocked with a lightweight
// stand-in `AuthorizationError` class (rather than pulling in the real module,
// which would transitively import next-auth / bcryptjs via lib/auth.ts) so
// `mapAuthError`'s `instanceof` check still works correctly.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/r2", () => ({ deleteObjects: vi.fn() }));

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
    requireProjectRole: vi.fn(),
  };
});

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    task: model(),
    project: model(),
    activityLog: model(),
    projectMembership: model(),
    label: model(),
    attachment: model(),
    auditLog: model(),
  };
  prisma.$transaction = vi.fn();
  return { prisma };
});

import { prisma } from "@/lib/db";
import { AuthorizationError, requireProjectRole } from "@/lib/permissions";
import { createTask, moveTask, updateTask } from "./actions";
import { POSITION_STEP, computeMidpoint } from "./positioning";

interface MockModel {
  findUnique: Mock;
  findMany: Mock;
  create: Mock;
  createMany: Mock;
  update: Mock;
  updateMany: Mock;
  delete: Mock;
  aggregate: Mock;
}
interface MockPrisma {
  task: MockModel;
  project: MockModel;
  activityLog: MockModel;
  projectMembership: MockModel;
  label: MockModel;
  attachment: MockModel;
  auditLog: MockModel;
  $transaction: Mock;
}

const db = prisma as unknown as MockPrisma;
const mockRequireProjectRole = requireProjectRole as unknown as Mock;

const MEMBER_USER = { id: "user-1", globalRole: "USER" };

beforeEach(() => {
  vi.clearAllMocks();
  // Every actions.ts call site does `prisma.$transaction(async (tx) => ...)` —
  // hand the callback the same mock object so `tx.x` === `prisma.x`.
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db));
  mockRequireProjectRole.mockResolvedValue({ user: MEMBER_USER, role: "MEMBER" });
});

describe("createTask — key generation", () => {
  it("generates the key as `${project.key}-${counter}` from the incremented counter", async () => {
    db.project.update.mockResolvedValue({ key: "OPS", taskCounter: 43 });
    db.task.aggregate.mockResolvedValue({ _max: { position: null } });
    db.task.create.mockResolvedValue({ id: "task-1", key: "OPS-43" });
    db.activityLog.create.mockResolvedValue({});

    const result = await createTask({ projectId: "proj-1", title: "Ship the thing" });

    expect(result).toEqual({ ok: true, data: { id: "task-1", key: "OPS-43" } });
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { taskCounter: { increment: 1 } },
      select: { key: true, taskCounter: true },
    });
    expect(db.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ key: "OPS-43", projectId: "proj-1" }),
      }),
    );
  });

  it("uses whatever counter value the atomic increment returns — not a locally tracked count", async () => {
    db.project.update.mockResolvedValue({ key: "SEC", taskCounter: 7 });
    db.task.aggregate.mockResolvedValue({ _max: { position: null } });
    db.task.create.mockResolvedValue({ id: "task-2", key: "SEC-7" });
    db.activityLog.create.mockResolvedValue({});

    const result = await createTask({ projectId: "proj-2", title: "Fix the bug" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.key).toBe("SEC-7");
  });

  it("places the new task at the bottom of the TODO column via computeMidpoint", async () => {
    db.project.update.mockResolvedValue({ key: "OPS", taskCounter: 1 });
    db.task.aggregate.mockResolvedValue({ _max: { position: 500 } });
    db.task.create.mockResolvedValue({ id: "task-3", key: "OPS-1" });
    db.activityLog.create.mockResolvedValue({});

    await createTask({ projectId: "proj-1", title: "Another task" });

    expect(db.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: computeMidpoint(500, null) }),
      }),
    );
  });

  it("fails validation (empty title) before ever checking permissions", async () => {
    const result = await createTask({ projectId: "proj-1", title: "" });
    expect(result.ok).toBe(false);
    expect(mockRequireProjectRole).not.toHaveBeenCalled();
  });

  it("maps a FORBIDDEN permission failure to a friendly error and touches no data", async () => {
    mockRequireProjectRole.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await createTask({ projectId: "proj-1", title: "Task" });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it("rejects an assignee who isn't a member of the project, before bumping the counter", async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);

    const result = await createTask({
      projectId: "proj-1",
      title: "Task",
      assigneeId: "not-a-member",
    });

    expect(result).toEqual({
      ok: false,
      error: "The assignee must be a member of the project.",
    });
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it("rejects a parent task that doesn't belong to the same project", async () => {
    db.task.findUnique.mockResolvedValue({ projectId: "other-project", parentId: null });

    const result = await createTask({
      projectId: "proj-1",
      title: "Subtask",
      parentId: "parent-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "The parent task doesn't belong to this project.",
    });
  });

  it("rejects nesting a subtask under another subtask (one level deep only)", async () => {
    db.task.findUnique.mockResolvedValue({
      projectId: "proj-1",
      parentId: "grandparent-1",
    });

    const result = await createTask({
      projectId: "proj-1",
      title: "Sub-subtask",
      parentId: "parent-1",
    });

    expect(result).toEqual({ ok: false, error: "Subtasks can only be one level deep." });
  });

  it("rejects labels that don't all belong to the project", async () => {
    db.label.findMany.mockResolvedValue([{ id: "label-1" }]); // only 1 of 2 found

    const result = await createTask({
      projectId: "proj-1",
      title: "Task",
      labelIds: ["label-1", "label-2"],
    });

    expect(result).toEqual({
      ok: false,
      error: "One or more labels don't belong to this project.",
    });
  });
});

describe("updateTask — estimatedHours", () => {
  const CURRENT_TASK = {
    id: "task-1",
    projectId: "proj-1",
    title: "Ship the thing",
    description: null,
    type: "TASK",
    status: "TODO",
    priority: "MEDIUM",
    assigneeId: null,
    dueDate: null,
    estimatedHours: null,
    labels: [],
  };

  it("threads a new estimatedHours into the update data and logs the change", async () => {
    db.task.findUnique.mockResolvedValue(CURRENT_TASK);
    db.task.update.mockResolvedValue({});
    db.activityLog.createMany.mockResolvedValue({});

    const result = await updateTask({ taskId: "task-1", estimatedHours: 6.5 });

    expect(result).toEqual({ ok: true, data: { id: "task-1" } });
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { estimatedHours: 6.5 },
    });
    expect(db.activityLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          field: "estimatedHours",
          oldValue: null,
          newValue: "6.5",
        }),
      ],
    });
  });

  it("clears estimatedHours to null and logs old -> new as stringified values", async () => {
    db.task.findUnique.mockResolvedValue({ ...CURRENT_TASK, estimatedHours: 6.5 });
    db.task.update.mockResolvedValue({});
    db.activityLog.createMany.mockResolvedValue({});

    const result = await updateTask({ taskId: "task-1", estimatedHours: null });

    expect(result.ok).toBe(true);
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { estimatedHours: null },
    });
    expect(db.activityLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          field: "estimatedHours",
          oldValue: "6.5",
          newValue: null,
        }),
      ],
    });
  });

  it("no-ops (no DB write, no activity log) when estimatedHours is unchanged", async () => {
    db.task.findUnique.mockResolvedValue({ ...CURRENT_TASK, estimatedHours: 10 });

    const result = await updateTask({ taskId: "task-1", estimatedHours: 10 });

    expect(result).toEqual({ ok: true, data: { id: "task-1" } });
    expect(db.task.update).not.toHaveBeenCalled();
    expect(db.activityLog.createMany).not.toHaveBeenCalled();
  });

  it("rejects a negative estimatedHours before ever touching the DB", async () => {
    const result = await updateTask({ taskId: "task-1", estimatedHours: -1 });
    expect(result.ok).toBe(false);
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });
});

describe("moveTask — before/after neighbour resolution", () => {
  it("computes the midpoint of the resolved before/after neighbours", async () => {
    db.task.findUnique.mockResolvedValue({ id: "t1", projectId: "proj-1", status: "TODO" });
    db.task.findMany.mockResolvedValue([
      { id: "b1", projectId: "proj-1", status: "IN_PROGRESS", position: 10 },
      { id: "a1", projectId: "proj-1", status: "IN_PROGRESS", position: 20 },
    ]);
    db.task.update.mockResolvedValue({});
    db.activityLog.create.mockResolvedValue({});

    const result = await moveTask({
      taskId: "t1",
      toStatus: "IN_PROGRESS",
      beforeTaskId: "b1",
      afterTaskId: "a1",
    });

    expect(result).toEqual({ ok: true, data: { id: "t1" } });
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { position: computeMidpoint(10, 20), status: "IN_PROGRESS" },
    });
    // Status changed TODO -> IN_PROGRESS, so a "moved" activity row is written.
    expect(db.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "moved",
          oldValue: "TODO",
          newValue: "IN_PROGRESS",
        }),
      }),
    );
  });

  it("resolves an only-before drop (bottom of column) and skips the activity log when status is unchanged", async () => {
    db.task.findUnique.mockResolvedValue({ id: "t1", projectId: "proj-1", status: "TODO" });
    db.task.findMany.mockResolvedValue([
      { id: "b1", projectId: "proj-1", status: "TODO", position: 10 },
    ]);
    db.task.update.mockResolvedValue({});

    const result = await moveTask({
      taskId: "t1",
      toStatus: "TODO",
      beforeTaskId: "b1",
      afterTaskId: null,
    });

    expect(result.ok).toBe(true);
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { position: computeMidpoint(10, null), status: "TODO" },
    });
    expect(db.activityLog.create).not.toHaveBeenCalled();
  });

  it("resolves an only-after drop (top of column)", async () => {
    db.task.findUnique.mockResolvedValue({ id: "t1", projectId: "proj-1", status: "TODO" });
    db.task.findMany.mockResolvedValue([
      { id: "a1", projectId: "proj-1", status: "IN_PROGRESS", position: 20 },
    ]);
    db.task.update.mockResolvedValue({});
    db.activityLog.create.mockResolvedValue({});

    await moveTask({
      taskId: "t1",
      toStatus: "IN_PROGRESS",
      beforeTaskId: null,
      afterTaskId: "a1",
    });

    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { position: computeMidpoint(null, 20), status: "IN_PROGRESS" },
    });
  });

  it("fails with a retry message when a resolved neighbour's status no longer matches (stale board)", async () => {
    db.task.findUnique.mockResolvedValue({ id: "t1", projectId: "proj-1", status: "TODO" });
    // Neighbour "b1" has already moved to DONE by someone else since the client fetched it.
    db.task.findMany.mockResolvedValue([
      { id: "b1", projectId: "proj-1", status: "DONE", position: 10 },
    ]);

    const result = await moveTask({
      taskId: "t1",
      toStatus: "IN_PROGRESS",
      beforeTaskId: "b1",
      afterTaskId: null,
    });

    expect(result).toEqual({
      ok: false,
      error: "The board changed — please retry the move.",
    });
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("re-spaces the whole column and re-inserts when neighbours are too close to bisect", async () => {
    db.task.findUnique.mockResolvedValue({ id: "t1", projectId: "proj-1", status: "TODO" });
    // 1st findMany: neighbour lookup — before/after are a hair apart (needs rebalance).
    db.task.findMany.mockResolvedValueOnce([
      { id: "c2", projectId: "proj-1", status: "IN_PROGRESS", position: 10.0000001 },
      { id: "c3", projectId: "proj-1", status: "IN_PROGRESS", position: 10.0000002 },
    ]);
    // 2nd findMany: the full destination column (excluding the moved card), ordered.
    db.task.findMany.mockResolvedValueOnce([
      { id: "c1" },
      { id: "c2" },
      { id: "c3" },
      { id: "c4" },
    ]);
    db.task.update.mockResolvedValue({});
    db.activityLog.create.mockResolvedValue({});

    const result = await moveTask({
      taskId: "t1",
      toStatus: "IN_PROGRESS",
      beforeTaskId: "c2",
      afterTaskId: "c3",
    });

    expect(result.ok).toBe(true);
    // rebalancedPositions(4) = [STEP, 2*STEP, 3*STEP, 4*STEP] — verified exhaustively
    // in positioning.test.ts; here we only confirm moveTask applies them in order.
    expect(db.task.update).toHaveBeenNthCalledWith(1, {
      where: { id: "c1" },
      data: { position: POSITION_STEP * 1 },
    });
    expect(db.task.update).toHaveBeenNthCalledWith(2, {
      where: { id: "c2" },
      data: { position: POSITION_STEP * 2 },
    });
    expect(db.task.update).toHaveBeenNthCalledWith(3, {
      where: { id: "c3" },
      data: { position: POSITION_STEP * 3 },
    });
    expect(db.task.update).toHaveBeenNthCalledWith(4, {
      where: { id: "c4" },
      data: { position: POSITION_STEP * 4 },
    });
    // Final placement: midpoint of the freshly re-spaced c2/c3 positions.
    expect(db.task.update).toHaveBeenNthCalledWith(5, {
      where: { id: "t1" },
      data: {
        position: computeMidpoint(POSITION_STEP * 2, POSITION_STEP * 3),
        status: "IN_PROGRESS",
      },
    });
  });

  it("fails validation before touching the DB when toStatus is not a real status", async () => {
    const result = await moveTask({
      taskId: "t1",
      toStatus: "NOT_A_STATUS",
      beforeTaskId: null,
      afterTaskId: null,
    });
    expect(result.ok).toBe(false);
    expect(db.task.findUnique).not.toHaveBeenCalled();
  });

  it("returns a not-found error when the task doesn't exist", async () => {
    db.task.findUnique.mockResolvedValue(null);
    const result = await moveTask({
      taskId: "missing",
      toStatus: "TODO",
      beforeTaskId: null,
      afterTaskId: null,
    });
    expect(result).toEqual({ ok: false, error: "Task not found." });
  });
});
