// Focused tests for the three per-project membership actions after the A4
// refactor: they must write `manualRole` (never `projectRole` directly) and
// delegate the effective-role computation to `recomputeMembership` (A2). The
// engine itself is mocked out here — it already has its own coverage — so
// these tests only assert the actions call it correctly and keep the same
// audit trail / idempotency behaviour they had before the refactor.
//
// Mocking mirrors tasks/actions.test.ts + comments/actions.test.ts: @/lib/db is
// a hand-rolled mock whose `prisma.x` and the `tx` passed into `$transaction`
// are the SAME object (our fake `$transaction` just invokes the callback with
// it). @/lib/permissions is a lightweight stand-in. @/lib/access-sync is
// mocked so `recomputeMembership` is a bare vi.fn() — we assert the CALL,
// never run the real engine.

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
    requireAdmin: vi.fn(),
  };
});

vi.mock("@/lib/access-sync", () => ({
  recomputeMembership: vi.fn(),
  recomputeForTeam: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    project: model(),
    user: model(),
    projectMembership: model(),
    auditLog: model(),
    invite: model(),
    team: model(),
    teamMembership: model(),
    teamProject: model(),
    projectLead: model(),
  };
  prisma.$transaction = vi.fn();
  return { prisma };
});

import { prisma } from "@/lib/db";
import { AuthorizationError, requireAdmin, requireProjectRole } from "@/lib/permissions";
import { recomputeForTeam, recomputeMembership } from "@/lib/access-sync";
import {
  addProjectMember,
  assignTeamManager,
  createTeam,
  removeProjectMember,
  updateProjectMember,
  updateTeam,
} from "./actions";

interface MockModel {
  findUnique: Mock;
  findMany: Mock;
  create: Mock;
  update: Mock;
  upsert: Mock;
  delete: Mock;
  count: Mock;
}
interface MockPrisma {
  project: MockModel;
  user: MockModel;
  projectMembership: MockModel;
  auditLog: MockModel;
  invite: MockModel;
  team: MockModel;
  teamMembership: MockModel;
  teamProject: MockModel;
  projectLead: MockModel;
  $transaction: Mock;
}

const db = prisma as unknown as MockPrisma;
const mockRequireProjectRole = requireProjectRole as unknown as Mock;
const mockRequireAdmin = requireAdmin as unknown as Mock;
const mockRecomputeMembership = recomputeMembership as unknown as Mock;
const mockRecomputeForTeam = recomputeForTeam as unknown as Mock;

const ACTOR = { id: "actor-1", globalRole: "ADMIN" };
const PROJECT_ID = "proj-1";
const USER_ID = "user-1";
const TEAM_ID = "team-1";

beforeEach(() => {
  vi.clearAllMocks();
  // Every actions.ts call site does `prisma.$transaction(async (tx) => ...)` —
  // hand the callback the same mock object so `tx.x` === `prisma.x`.
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db));
  mockRequireProjectRole.mockResolvedValue({ user: ACTOR, role: "MANAGER" });
  mockRequireAdmin.mockResolvedValue(ACTOR);
  db.auditLog.create.mockResolvedValue({});
  mockRecomputeMembership.mockResolvedValue(undefined);
  mockRecomputeForTeam.mockResolvedValue(undefined);
  // assignTeamManager reads the team's projects to recompute a demoted former
  // manager — default to no projects so unrelated tests don't hit undefined.
  db.teamProject.findMany.mockResolvedValue([]);
});

describe("addProjectMember", () => {
  it("upserts manualRole (not projectRole) and calls recomputeMembership, then audits membership.granted", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID });
    db.user.findUnique.mockResolvedValue({ id: USER_ID });
    db.projectMembership.upsert.mockResolvedValue({});

    const result = await addProjectMember({
      projectId: PROJECT_ID,
      userId: USER_ID,
      projectRole: "MEMBER",
    });

    expect(result).toEqual({ ok: true });
    expect(db.projectMembership.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
      update: { manualRole: "MEMBER" },
      create: {
        projectId: PROJECT_ID,
        userId: USER_ID,
        projectRole: "MEMBER",
        manualRole: "MEMBER",
      },
    });
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, USER_ID);
    // recompute must run AFTER the upsert so it sees the just-written manualRole.
    const upsertOrder = db.projectMembership.upsert.mock.invocationCallOrder[0];
    const recomputeOrder = mockRecomputeMembership.mock.invocationCallOrder[0];
    expect(upsertOrder).toBeLessThan(recomputeOrder);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "membership.granted",
          targetType: "ProjectMembership",
          targetId: USER_ID,
          metadata: { projectId: PROJECT_ID, userId: USER_ID, projectRole: "MEMBER" },
        }),
      }),
    );
  });

  it("returns not-found errors without touching the DB when the project or user is missing", async () => {
    db.project.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ id: USER_ID });

    const result = await addProjectMember({
      projectId: PROJECT_ID,
      userId: USER_ID,
      projectRole: "MEMBER",
    });

    expect(result).toEqual({ ok: false, error: "Project not found." });
    expect(db.projectMembership.upsert).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
  });
});

describe("updateProjectMember", () => {
  it("treats a purely-derived row (manualRole === null) as NOT a manual member", async () => {
    db.projectMembership.findUnique.mockResolvedValue({
      projectRole: "MEMBER",
      manualRole: null,
    });

    const result = await updateProjectMember({
      projectId: PROJECT_ID,
      userId: USER_ID,
      projectRole: "MANAGER",
    });

    expect(result).toEqual({
      ok: false,
      error: "That user isn't a member of this project.",
    });
    expect(db.projectMembership.update).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
  });

  it("is an idempotent no-op when the requested role matches the existing manualRole", async () => {
    db.projectMembership.findUnique.mockResolvedValue({
      projectRole: "MEMBER",
      manualRole: "MEMBER",
    });

    const result = await updateProjectMember({
      projectId: PROJECT_ID,
      userId: USER_ID,
      projectRole: "MEMBER",
    });

    expect(result).toEqual({ ok: true });
    expect(db.projectMembership.update).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
  });

  it("sets manualRole, calls recomputeMembership, and audits membership.role_changed when a manual row's role differs", async () => {
    db.projectMembership.findUnique.mockResolvedValue({
      projectRole: "MEMBER",
      manualRole: "MEMBER",
    });
    db.projectMembership.update.mockResolvedValue({});

    const result = await updateProjectMember({
      projectId: PROJECT_ID,
      userId: USER_ID,
      projectRole: "MANAGER",
    });

    expect(result).toEqual({ ok: true });
    expect(db.projectMembership.update).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
      data: { manualRole: "MANAGER" },
    });
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, USER_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "membership.role_changed",
          targetType: "ProjectMembership",
          targetId: USER_ID,
          metadata: { projectId: PROJECT_ID, userId: USER_ID, from: "MEMBER", to: "MANAGER" },
        }),
      }),
    );
  });
});

describe("removeProjectMember", () => {
  it("clears manualRole and calls recomputeMembership (team still justifies access — max(manual, team) reflected by the engine)", async () => {
    db.projectMembership.findUnique.mockResolvedValue({
      projectRole: "MANAGER", // effective role was max(manual MEMBER, team MANAGER)
      manualRole: "MEMBER",
    });
    db.projectMembership.update.mockResolvedValue({});

    const result = await removeProjectMember({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    // Refactor must NOT delete the row directly — recomputeMembership owns
    // deletion (iff nothing else justifies access) or downgrade.
    expect(db.projectMembership.delete).not.toHaveBeenCalled();
    expect(db.projectMembership.update).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
      data: { manualRole: null },
    });
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, USER_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "membership.revoked",
          targetType: "ProjectMembership",
          targetId: USER_ID,
          metadata: { projectId: PROJECT_ID, userId: USER_ID, projectRole: "MANAGER" },
        }),
      }),
    );
  });

  it("is idempotent when no manual row exists (no row at all)", async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);

    const result = await removeProjectMember({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.projectMembership.update).not.toHaveBeenCalled();
    expect(db.projectMembership.delete).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("is idempotent when the existing row is purely derived (manualRole already null)", async () => {
    db.projectMembership.findUnique.mockResolvedValue({
      projectRole: "MANAGER",
      manualRole: null,
    });

    const result = await removeProjectMember({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.projectMembership.update).not.toHaveBeenCalled();
    expect(db.projectMembership.delete).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Teams (Teams Org Foundation — Phase B, Task B1)
// ─────────────────────────────────────────────────────────────────────────────

describe("createTeam", () => {
  it("requires admin — non-admin gets ok:false and never touches the DB", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await createTeam({ name: "Kitchen Ops" });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.team.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("creates the team and audits team.created", async () => {
    db.team.create.mockResolvedValue({ id: TEAM_ID, name: "Kitchen Ops", description: null });

    const result = await createTeam({ name: "Kitchen Ops", description: "Front of house" });

    expect(result).toEqual({ ok: true, data: { teamId: TEAM_ID } });
    expect(db.team.create).toHaveBeenCalledWith({
      data: { name: "Kitchen Ops", description: "Front of house" },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "team.created",
          targetType: "Team",
          targetId: TEAM_ID,
        }),
      }),
    );
  });

  it("rejects invalid input before touching the DB", async () => {
    const result = await createTeam({ name: "" });

    expect(result.ok).toBe(false);
    expect(db.team.create).not.toHaveBeenCalled();
  });
});

describe("updateTeam", () => {
  it("requires admin — non-admin gets ok:false", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await updateTeam({ teamId: TEAM_ID, name: "New name" });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.team.update).not.toHaveBeenCalled();
  });

  it("returns not-found when the team doesn't exist", async () => {
    db.team.findUnique.mockResolvedValue(null);

    const result = await updateTeam({ teamId: TEAM_ID, name: "New name" });

    expect(result).toEqual({ ok: false, error: "Team not found." });
    expect(db.team.update).not.toHaveBeenCalled();
  });

  it("plain field update (isActive unchanged) audits team.updated and does NOT call recomputeForTeam", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, name: "Old", description: null, isActive: true });
    db.team.update.mockResolvedValue({});

    const result = await updateTeam({ teamId: TEAM_ID, name: "New name" });

    expect(result).toEqual({ ok: true });
    expect(db.team.update).toHaveBeenCalledWith({
      where: { id: TEAM_ID },
      data: { name: "New name" },
    });
    expect(mockRecomputeForTeam).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "team.updated", targetType: "Team", targetId: TEAM_ID }),
      }),
    );
  });

  it("activating an inactive team audits team.activated and calls recomputeForTeam", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, name: "Old", description: null, isActive: false });
    db.team.update.mockResolvedValue({});

    const result = await updateTeam({ teamId: TEAM_ID, isActive: true });

    expect(result).toEqual({ ok: true });
    expect(mockRecomputeForTeam).toHaveBeenCalledWith(db, TEAM_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "team.activated", targetType: "Team", targetId: TEAM_ID }),
      }),
    );
  });

  it("deactivating an active team audits team.deactivated and calls recomputeForTeam", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, name: "Old", description: null, isActive: true });
    db.team.update.mockResolvedValue({});

    const result = await updateTeam({ teamId: TEAM_ID, isActive: false });

    expect(result).toEqual({ ok: true });
    expect(mockRecomputeForTeam).toHaveBeenCalledWith(db, TEAM_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "team.deactivated", targetType: "Team", targetId: TEAM_ID }),
      }),
    );
  });

  it("setting isActive to its current value does not call recomputeForTeam and audits team.updated", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, name: "Old", description: null, isActive: true });
    db.team.update.mockResolvedValue({});

    const result = await updateTeam({ teamId: TEAM_ID, isActive: true });

    expect(result).toEqual({ ok: true });
    expect(mockRecomputeForTeam).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "team.updated" }),
      }),
    );
  });
});

describe("assignTeamManager", () => {
  it("requires admin — non-admin gets ok:false", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await assignTeamManager({ teamId: TEAM_ID, managerId: USER_ID });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.team.update).not.toHaveBeenCalled();
  });

  it("returns not-found when the team doesn't exist", async () => {
    db.team.findUnique.mockResolvedValue(null);

    const result = await assignTeamManager({ teamId: TEAM_ID, managerId: USER_ID });

    expect(result).toEqual({ ok: false, error: "Team not found." });
    expect(db.team.update).not.toHaveBeenCalled();
  });

  it("rejects a non-existent target user", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, managerId: null });
    db.user.findUnique.mockResolvedValue(null);

    const result = await assignTeamManager({ teamId: TEAM_ID, managerId: USER_ID });

    expect(result).toEqual({ ok: false, error: "User not found." });
    expect(db.team.update).not.toHaveBeenCalled();
  });

  it("rejects a non-ACTIVE target user", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, managerId: null });
    db.user.findUnique.mockResolvedValue({ id: USER_ID, status: "SUSPENDED" });

    const result = await assignTeamManager({ teamId: TEAM_ID, managerId: USER_ID });

    expect(result).toEqual({ ok: false, error: "Manager must be an active user." });
    expect(db.team.update).not.toHaveBeenCalled();
  });

  it("sets managerId, calls recomputeForTeam, and audits team.manager_assigned", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, managerId: null });
    db.user.findUnique.mockResolvedValue({ id: USER_ID, status: "ACTIVE" });
    db.team.update.mockResolvedValue({});

    const result = await assignTeamManager({ teamId: TEAM_ID, managerId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.team.update).toHaveBeenCalledWith({
      where: { id: TEAM_ID },
      data: { managerId: USER_ID },
    });
    expect(mockRecomputeForTeam).toHaveBeenCalledWith(db, TEAM_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "team.manager_assigned",
          targetType: "Team",
          targetId: TEAM_ID,
          metadata: { teamId: TEAM_ID, managerId: USER_ID },
        }),
      }),
    );
  });

  it("allows clearing the manager (managerId: null) without a user lookup", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, managerId: USER_ID });
    db.team.update.mockResolvedValue({});

    const result = await assignTeamManager({ teamId: TEAM_ID, managerId: null });

    expect(result).toEqual({ ok: true });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.team.update).toHaveBeenCalledWith({
      where: { id: TEAM_ID },
      data: { managerId: null },
    });
    expect(mockRecomputeForTeam).toHaveBeenCalledWith(db, TEAM_ID);
  });

  it("recomputes the FORMER manager across the team's projects on a manager change", async () => {
    const FORMER = "former-manager";
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, managerId: FORMER });
    db.user.findUnique.mockResolvedValue({ id: USER_ID, status: "ACTIVE" });
    db.team.update.mockResolvedValue({});
    db.teamProject.findMany.mockResolvedValue([
      { projectId: "p1" },
      { projectId: "p2" },
    ]);

    const result = await assignTeamManager({ teamId: TEAM_ID, managerId: USER_ID });

    expect(result).toEqual({ ok: true });
    // The demoted former manager must be re-evaluated so stale MANAGER-derived
    // access is stripped (recomputeForTeam alone only covers the current set).
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, "p1", FORMER);
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, "p2", FORMER);
  });
});
