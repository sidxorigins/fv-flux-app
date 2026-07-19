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
  };
});

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  const prisma: Record<string, unknown> = { task: model(), timeEntry: model(), user: model() };
  // $transaction(fn) runs fn with the same prisma as the tx client.
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireProjectRole, requireUser } from "@/lib/permissions";
import { startTimer, stopTimer, updateTimeEntry } from "./actions";

interface MockModel { findUnique: Mock; findFirst: Mock; create: Mock; update: Mock; delete: Mock }
const db = prisma as unknown as { task: MockModel; timeEntry: MockModel; user: MockModel };
const mockRPR = requireProjectRole as unknown as Mock;
const mockRU = requireUser as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findUnique.mockResolvedValue({ projectId: "p1", key: "OPS-1" });
  db.timeEntry.findFirst.mockResolvedValue(null);
  db.timeEntry.create.mockResolvedValue({ id: "te-new" });
  db.timeEntry.update.mockResolvedValue({});
  mockRPR.mockResolvedValue({ user: { id: "u1" }, role: "MEMBER" });
  mockRU.mockResolvedValue({ id: "u1" });
});

describe("startTimer", () => {
  it("starts a timer for a MEMBER (no prior running)", async () => {
    const res = await startTimer({ taskId: "t1" });
    expect(res).toEqual({ ok: true, data: { startedTaskKey: "OPS-1", stoppedTaskKey: null } });
    expect(db.timeEntry.create).toHaveBeenCalledOnce();
  });

  it("auto-stops a running timer on another task, then starts", async () => {
    db.timeEntry.findFirst.mockResolvedValue({
      id: "te-old",
      startedAt: new Date(Date.now() - 90 * 60000),
      task: { key: "OPS-9" },
    });
    const res = await startTimer({ taskId: "t1" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.stoppedTaskKey).toBe("OPS-9");
    // old timer closed with minutes ~90
    expect(db.timeEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "te-old" },
        data: expect.objectContaining({ minutes: expect.any(Number) }),
      }),
    );
    expect(db.timeEntry.create).toHaveBeenCalledOnce();
  });

  it("rejects a VIEWER", async () => {
    const { AuthorizationError } = await import("@/lib/permissions");
    mockRPR.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    const res = await startTimer({ taskId: "t1" });
    expect(res).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.timeEntry.create).not.toHaveBeenCalled();
  });
});

describe("stopTimer", () => {
  it("closes the running timer with rounded minutes (min 1)", async () => {
    db.timeEntry.findFirst.mockResolvedValue({
      id: "te-run",
      startedAt: new Date(Date.now() - 20 * 1000), // 20s → rounds to 1 min floor
      task: { projectId: "p1" },
    });
    const res = await stopTimer();
    expect(res).toEqual({ ok: true, data: { stopped: true } });
    expect(db.timeEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ minutes: 1 }) }),
    );
  });

  it("no-op when nothing is running", async () => {
    db.timeEntry.findFirst.mockResolvedValue(null);
    const res = await stopTimer();
    expect(res).toEqual({ ok: true, data: { stopped: false } });
    expect(db.timeEntry.update).not.toHaveBeenCalled();
  });
});

describe("updateTimeEntry", () => {
  it("forbids a MEMBER editing someone else's entry", async () => {
    db.timeEntry.findUnique.mockResolvedValue({
      id: "te1", userId: "other", endedAt: new Date(), task: { projectId: "p1" },
    });
    mockRPR.mockResolvedValue({ user: { id: "u1" }, role: "MEMBER" });
    const res = await updateTimeEntry({ id: "te1", minutes: 30 });
    expect(res.ok).toBe(false);
    expect(db.timeEntry.update).not.toHaveBeenCalled();
  });

  it("lets a MANAGER edit anyone's entry", async () => {
    db.timeEntry.findUnique.mockResolvedValue({
      id: "te1", userId: "other", endedAt: new Date(), task: { projectId: "p1" },
    });
    mockRPR.mockResolvedValue({ user: { id: "mgr" }, role: "MANAGER" });
    const res = await updateTimeEntry({ id: "te1", minutes: 30 });
    expect(res.ok).toBe(true);
    expect(db.timeEntry.update).toHaveBeenCalledOnce();
  });
});
