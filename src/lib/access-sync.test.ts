import { describe, it, expect, vi } from "vitest";

// access-sync.ts imports PROJECT_ROLE_ORDER from "@/lib/permissions", which in turn
// imports "@/lib/auth" (next-auth) and "@/lib/db" (Prisma client). Neither is needed
// for this pure/fake-tx test, and both have real side effects at import time (auth.ts
// pulls in next-auth internals that don't resolve in the Vitest environment; db.ts
// opens a real Prisma adapter). Mock them exactly as src/lib/permissions.test.ts does
// so the REAL permissions.ts (and its real PROJECT_ROLE_ORDER) loads without those
// side effects.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projectMembership: { findUnique: vi.fn() },
  },
}));

import {
  maxRole,
  recomputeMembership,
  recomputeForTeam,
  recomputeForProject,
} from "./access-sync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTx(over: Partial<Record<string, any>> = {}) {
  return {
    projectMembership: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    teamProject: { findMany: vi.fn().mockResolvedValue([]) },
    teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findUnique: vi.fn().mockResolvedValue({ leadId: "someone-else" }) },
    projectLead: { findUnique: vi.fn().mockResolvedValue(null) },
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const PROJECT_ID = "proj-1";
const USER_ID = "U";

describe("maxRole", () => {
  it("returns null for an empty list", () => {
    expect(maxRole([])).toBeNull();
  });

  it("returns the highest role by PROJECT_ROLE_ORDER", () => {
    expect(maxRole(["VIEWER", "MANAGER", "MEMBER"])).toBe("MANAGER");
  });
});

describe("recomputeMembership", () => {
  it("manual-only: upserts projectRole from manualRole", async () => {
    const tx = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue({ manualRole: "MEMBER" }),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });

    await recomputeMembership(tx, PROJECT_ID, USER_ID);

    expect(tx.projectMembership.upsert).toHaveBeenCalledTimes(1);
    const call = tx.projectMembership.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      projectId_userId: { projectId: PROJECT_ID, userId: USER_ID },
    });
    expect(call.update).toEqual({ projectRole: "MEMBER" });
    expect(call.create).toMatchObject({
      projectId: PROJECT_ID,
      userId: USER_ID,
      projectRole: "MEMBER",
    });
    expect(tx.projectMembership.delete).not.toHaveBeenCalled();
  });

  it("team-only: upserts projectRole from the team's assigned role", async () => {
    const tx = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue({ manualRole: null }),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      teamProject: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ role: "MEMBER", teamId: "t1", team: { managerId: null } }]),
      },
      teamMembership: {
        findMany: vi.fn().mockResolvedValue([{ teamId: "t1" }]),
      },
    });

    await recomputeMembership(tx, PROJECT_ID, USER_ID);

    expect(tx.projectMembership.upsert).toHaveBeenCalledTimes(1);
    expect(tx.projectMembership.upsert.mock.calls[0][0].update).toEqual({
      projectRole: "MEMBER",
    });
  });

  it("manager-of-team: user is the team's manager (not a member) ⇒ MANAGER", async () => {
    const tx = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      teamProject: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ role: "MEMBER", teamId: "t1", team: { managerId: USER_ID } }]),
      },
      teamMembership: {
        // The user under test is NOT a member of the team — only its manager.
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    await recomputeMembership(tx, PROJECT_ID, USER_ID);

    expect(tx.projectMembership.upsert).toHaveBeenCalledTimes(1);
    expect(tx.projectMembership.upsert.mock.calls[0][0].update).toEqual({
      projectRole: "MANAGER",
    });
  });

  it("lead-only (primary leadId): upserts MANAGER", async () => {
    const tx = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      project: { findUnique: vi.fn().mockResolvedValue({ leadId: USER_ID }) },
    });

    await recomputeMembership(tx, PROJECT_ID, USER_ID);

    expect(tx.projectMembership.upsert).toHaveBeenCalledTimes(1);
    expect(tx.projectMembership.upsert.mock.calls[0][0].update).toEqual({
      projectRole: "MANAGER",
    });
  });

  it("lead-only (ProjectLead row): upserts MANAGER", async () => {
    const tx = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      projectLead: { findUnique: vi.fn().mockResolvedValue({ id: "x" }) },
    });

    await recomputeMembership(tx, PROJECT_ID, USER_ID);

    expect(tx.projectMembership.upsert).toHaveBeenCalledTimes(1);
    expect(tx.projectMembership.upsert.mock.calls[0][0].update).toEqual({
      projectRole: "MANAGER",
    });
  });

  it("overlap: manual MEMBER + team MANAGER ⇒ upserts MANAGER (manualRole preserved on the row, not overwritten)", async () => {
    const tx = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue({ manualRole: "MEMBER" }),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      teamProject: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ role: "MANAGER", teamId: "t1", team: { managerId: null } }]),
      },
      teamMembership: {
        findMany: vi.fn().mockResolvedValue([{ teamId: "t1" }]),
      },
    });

    await recomputeMembership(tx, PROJECT_ID, USER_ID);

    expect(tx.projectMembership.upsert).toHaveBeenCalledTimes(1);
    const call = tx.projectMembership.upsert.mock.calls[0][0];
    expect(call.update).toEqual({ projectRole: "MANAGER" });
    // manualRole itself is never written by recompute — only projectRole.
    expect(call.update).not.toHaveProperty("manualRole");
  });

  it("no source, existing row: deletes the membership", async () => {
    const tx = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue({ manualRole: null }),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });

    await recomputeMembership(tx, PROJECT_ID, USER_ID);

    expect(tx.projectMembership.delete).toHaveBeenCalledTimes(1);
    expect(tx.projectMembership.delete).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
    });
    expect(tx.projectMembership.upsert).not.toHaveBeenCalled();
  });

  it("no source, no existing row: does nothing (no upsert, no delete)", async () => {
    const tx = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });

    await recomputeMembership(tx, PROJECT_ID, USER_ID);

    expect(tx.projectMembership.upsert).not.toHaveBeenCalled();
    expect(tx.projectMembership.delete).not.toHaveBeenCalled();
  });

  it("overlap-then-removal: manual MEMBER + team MANAGER upserts MANAGER; removing the team source (second call) recomputes to MEMBER, row kept", async () => {
    // First call: manual + team overlap.
    const txWithTeam = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue({ manualRole: "MEMBER" }),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      teamProject: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ role: "MANAGER", teamId: "t1", team: { managerId: null } }]),
      },
      teamMembership: {
        findMany: vi.fn().mockResolvedValue([{ teamId: "t1" }]),
      },
    });
    await recomputeMembership(txWithTeam, PROJECT_ID, USER_ID);
    expect(txWithTeam.projectMembership.upsert.mock.calls[0][0].update).toEqual({
      projectRole: "MANAGER",
    });

    // Second call: team source removed, manualRole persists on the row ⇒ MEMBER, row kept (upsert, not delete).
    const txWithoutTeam = makeTx({
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue({ manualRole: "MEMBER" }),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      teamProject: { findMany: vi.fn().mockResolvedValue([]) },
    });
    await recomputeMembership(txWithoutTeam, PROJECT_ID, USER_ID);
    expect(txWithoutTeam.projectMembership.upsert.mock.calls[0][0].update).toEqual({
      projectRole: "MEMBER",
    });
    expect(txWithoutTeam.projectMembership.delete).not.toHaveBeenCalled();
  });
});

describe("recomputeForTeam", () => {
  it("recomputes for every (member ∪ manager) × project pair implied by the team", async () => {
    const tx = makeTx({
      team: {
        findUnique: vi.fn().mockResolvedValue({
          managerId: "mgr-1",
          members: [{ userId: "mem-1" }, { userId: "mem-2" }],
          projects: [{ projectId: "p1" }, { projectId: "p2" }],
        }),
      },
      // recomputeMembership internals — return neutral/empty fixtures so each
      // recomputeMembership call resolves without upserting/deleting.
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });

    await recomputeForTeam(tx, "team-1");

    // 3 distinct users (mgr-1, mem-1, mem-2) × 2 projects = 6 recompute calls.
    expect(tx.projectMembership.findUnique).toHaveBeenCalledTimes(6);
    const projectIdsCalled = tx.projectMembership.findUnique.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0].where.projectId_userId.projectId,
    );
    expect(new Set(projectIdsCalled)).toEqual(new Set(["p1", "p2"]));
  });

  it("no-ops when the team doesn't exist", async () => {
    const tx = makeTx({ team: { findUnique: vi.fn().mockResolvedValue(null) } });

    await recomputeForTeam(tx, "missing-team");

    expect(tx.projectMembership.findUnique).not.toHaveBeenCalled();
  });
});

describe("recomputeForProject", () => {
  it("recomputes for every lead, member, and team person on the project", async () => {
    const tx = makeTx({
      project: {
        findUnique: vi.fn().mockResolvedValue({
          leadId: "lead-1",
          additionalLeads: [{ userId: "lead-2" }],
          teams: [
            {
              team: {
                managerId: "tmgr-1",
                members: [{ userId: "tmem-1" }],
              },
            },
          ],
          memberships: [{ userId: "existing-member-1" }],
        }),
      },
      projectMembership: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });

    await recomputeForProject(tx, PROJECT_ID);

    // 5 distinct users: lead-1, lead-2, tmgr-1, tmem-1, existing-member-1.
    expect(tx.projectMembership.findUnique).toHaveBeenCalledTimes(5);
    const userIdsCalled = tx.projectMembership.findUnique.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0].where.projectId_userId.userId,
    );
    expect(new Set(userIdsCalled)).toEqual(
      new Set(["lead-1", "lead-2", "tmgr-1", "tmem-1", "existing-member-1"]),
    );
  });

  it("no-ops when the project doesn't exist", async () => {
    const tx = makeTx({ project: { findUnique: vi.fn().mockResolvedValue(null) } });

    await recomputeForProject(tx, "missing-project");

    expect(tx.projectMembership.findUnique).not.toHaveBeenCalled();
  });
});
