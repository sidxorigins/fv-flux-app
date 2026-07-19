import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

// "server-only" throws at import time unless bundled under the RSC ("react-server")
// export condition, which vitest doesn't set. Stub it to a no-op so queries.ts (which
// imports "server-only" per convention — see src/features/tasks/activity.ts) can load
// under test; this changes nothing about the behaviour being tested.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/permissions", () => ({
  PROJECT_ROLE_ORDER: { VIEWER: 0, MEMBER: 1, MANAGER: 2 },
  requireProjectRole: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const prisma = {
    task: { findUnique: vi.fn(), findMany: vi.fn() },
    timeEntry: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
  };
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireProjectRole, requireUser } from "@/lib/permissions";
import { getMyLoggedHours, getProjectTimeReport, getTaskTime } from "./queries";

const db = prisma as unknown as {
  task: { findUnique: Mock; findMany: Mock };
  timeEntry: { aggregate: Mock; groupBy: Mock; findMany: Mock };
  user: { findMany: Mock };
};
const mockRPR = requireProjectRole as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findUnique.mockResolvedValue({ projectId: "p1" });
  // total agg, then my agg (aggregate called twice; both return 60)
  db.timeEntry.aggregate.mockResolvedValue({ _sum: { minutes: 60 } });
  db.timeEntry.groupBy.mockResolvedValue([{ userId: "u1", _sum: { minutes: 60 } }]);
  db.user.findMany.mockResolvedValue([{ id: "u1", name: "A", username: "a", avatarKey: null }]);
  db.timeEntry.findMany.mockResolvedValue([]);
  db.task.findMany.mockResolvedValue([]);
});

describe("getTaskTime role gating", () => {
  it("hides per-user breakdown from a MEMBER (perUser null, own entries only)", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u1" }, role: "MEMBER" });
    const res = await getTaskTime("t1");
    expect(res.perUser).toBeNull();
    expect(res.canManage).toBe(false);
    expect(db.timeEntry.groupBy).not.toHaveBeenCalled();
    // entries query scoped to the caller
    expect(db.timeEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "u1" }) }),
    );
  });

  it("gives a MANAGER the per-user breakdown + all entries", async () => {
    mockRPR.mockResolvedValue({ user: { id: "mgr" }, role: "MANAGER" });
    const res = await getTaskTime("t1");
    expect(res.perUser).not.toBeNull();
    expect(res.canManage).toBe(true);
    expect(db.timeEntry.groupBy).toHaveBeenCalledOnce();
    // entries query NOT scoped to a single user
    const call = db.timeEntry.findMany.mock.calls[0][0];
    expect(call.where.userId).toBeUndefined();
  });
});

describe("getProjectTimeReport role gating", () => {
  it("member sees totals only (byUser/byTask null)", async () => {
    mockRPR.mockResolvedValue({ user: { id: "u1" }, role: "MEMBER" });
    db.timeEntry.aggregate.mockResolvedValue({ _sum: { minutes: 120 } });
    const res = await getProjectTimeReport("p1");
    expect(res.byUser).toBeNull();
    expect(res.byTask).toBeNull();
    expect(res.canManage).toBe(false);
  });
});

describe("getMyLoggedHours", () => {
  it("sums this week + groups by project (own only)", async () => {
    (requireUser as unknown as Mock).mockResolvedValue({ id: "u1" });
    db.timeEntry.aggregate.mockResolvedValue({ _sum: { minutes: 200 } });
    db.timeEntry.groupBy.mockResolvedValue([]); // no per-project rows
    const res = await getMyLoggedHours();
    expect(res.thisWeekMinutes).toBe(200);
    expect(res.byProject).toEqual([]);
    // aggregate where is scoped to the caller
    expect(db.timeEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "u1" }) }),
    );
  });
});
