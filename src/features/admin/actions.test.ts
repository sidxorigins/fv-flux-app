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
    requireTeamManage: vi.fn(),
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
import {
  AuthorizationError,
  requireAdmin,
  requireProjectRole,
  requireTeamManage,
} from "@/lib/permissions";
import { recomputeForTeam, recomputeMembership } from "@/lib/access-sync";
import {
  addProjectLead,
  addProjectMember,
  addTeamMember,
  assignTeamManager,
  assignTeamProject,
  createTeam,
  removeProjectLead,
  removeProjectMember,
  removeTeamMember,
  setPrimaryLead,
  unassignTeamProject,
  updateProjectMember,
  updateTeam,
  updateTeamProjectRole,
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
const mockRequireTeamManage = requireTeamManage as unknown as Mock;
const mockRecomputeMembership = recomputeMembership as unknown as Mock;
const mockRecomputeForTeam = recomputeForTeam as unknown as Mock;

const ACTOR = { id: "actor-1", globalRole: "ADMIN" };
const PROJECT_ID = "proj-1";
const USER_ID = "user-1";
const TEAM_ID = "team-1";
const MANAGER_ID = "manager-1";

beforeEach(() => {
  vi.clearAllMocks();
  // Every actions.ts call site does `prisma.$transaction(async (tx) => ...)` —
  // hand the callback the same mock object so `tx.x` === `prisma.x`.
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db));
  mockRequireProjectRole.mockResolvedValue({ user: ACTOR, role: "MANAGER" });
  mockRequireAdmin.mockResolvedValue(ACTOR);
  mockRequireTeamManage.mockResolvedValue(ACTOR);
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

// ─────────────────────────────────────────────────────────────────────────────
// Team membership + team↔project assignment (Teams Org Foundation, Task B2)
// ─────────────────────────────────────────────────────────────────────────────

describe("addTeamMember", () => {
  it("requireTeamManage gates it — a non-manager/non-admin gets ok:false and never touches the DB", async () => {
    mockRequireTeamManage.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await addTeamMember({ teamId: TEAM_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.teamMembership.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns not-found when the team doesn't exist", async () => {
    db.team.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ id: USER_ID });

    const result = await addTeamMember({ teamId: TEAM_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "Team not found." });
    expect(db.teamMembership.create).not.toHaveBeenCalled();
  });

  it("returns not-found when the user doesn't exist", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID });
    db.user.findUnique.mockResolvedValue(null);

    const result = await addTeamMember({ teamId: TEAM_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "User not found." });
    expect(db.teamMembership.create).not.toHaveBeenCalled();
  });

  it("is idempotent when the user is already a member", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID });
    db.user.findUnique.mockResolvedValue({ id: USER_ID });
    db.teamMembership.findUnique.mockResolvedValue({ id: "existing-row" });

    const result = await addTeamMember({ teamId: TEAM_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.teamMembership.create).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("creates the TeamMembership, recomputes the new member across the team's projects, and audits team.member_added", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID });
    db.user.findUnique.mockResolvedValue({ id: USER_ID });
    db.teamMembership.findUnique.mockResolvedValue(null);
    db.teamMembership.create.mockResolvedValue({});
    db.teamProject.findMany.mockResolvedValue([
      { projectId: "p1" },
      { projectId: "p2" },
    ]);

    const result = await addTeamMember({ teamId: TEAM_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.teamMembership.create).toHaveBeenCalledWith({
      data: { teamId: TEAM_ID, userId: USER_ID },
    });
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, "p1", USER_ID);
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, "p2", USER_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "team.member_added",
          targetType: "TeamMembership",
          targetId: USER_ID,
          metadata: { teamId: TEAM_ID, userId: USER_ID },
        }),
      }),
    );
  });
});

describe("removeTeamMember", () => {
  it("requireTeamManage gates it — a non-manager/non-admin gets ok:false and never touches the DB", async () => {
    mockRequireTeamManage.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await removeTeamMember({ teamId: TEAM_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.teamMembership.delete).not.toHaveBeenCalled();
  });

  it("is idempotent when no membership row exists", async () => {
    db.teamMembership.findUnique.mockResolvedValue(null);

    const result = await removeTeamMember({ teamId: TEAM_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.teamMembership.delete).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("CRITICAL: deletes the TeamMembership and recomputes the REMOVED user across the team's projects, then audits team.member_removed", async () => {
    db.teamMembership.findUnique.mockResolvedValue({ id: "existing-row" });
    db.teamMembership.delete.mockResolvedValue({});
    db.teamProject.findMany.mockResolvedValue([
      { projectId: "p1" },
      { projectId: "p2" },
    ]);

    const result = await removeTeamMember({ teamId: TEAM_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.teamMembership.delete).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: TEAM_ID, userId: USER_ID } },
    });
    // The removed user is no longer in the team's current member set, so
    // recomputeForTeam alone would never re-evaluate them — they must be
    // recomputed explicitly across every project the team is assigned to.
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, "p1", USER_ID);
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, "p2", USER_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "team.member_removed",
          targetType: "TeamMembership",
          targetId: USER_ID,
          metadata: { teamId: TEAM_ID, userId: USER_ID },
        }),
      }),
    );
  });
});

describe("assignTeamProject", () => {
  it("requires admin — non-admin gets ok:false and never touches the DB", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await assignTeamProject({ teamId: TEAM_ID, projectId: PROJECT_ID, role: "MEMBER" });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.teamProject.upsert).not.toHaveBeenCalled();
  });

  it("returns not-found when the team doesn't exist", async () => {
    db.team.findUnique.mockResolvedValue(null);
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID });

    const result = await assignTeamProject({ teamId: TEAM_ID, projectId: PROJECT_ID, role: "MEMBER" });

    expect(result).toEqual({ ok: false, error: "Team not found." });
    expect(db.teamProject.upsert).not.toHaveBeenCalled();
  });

  it("returns not-found when the project doesn't exist", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, managerId: null });
    db.project.findUnique.mockResolvedValue(null);

    const result = await assignTeamProject({ teamId: TEAM_ID, projectId: PROJECT_ID, role: "MEMBER" });

    expect(result).toEqual({ ok: false, error: "Project not found." });
    expect(db.teamProject.upsert).not.toHaveBeenCalled();
  });

  it("upserts the TeamProject idempotently, recomputes the team's members+manager for that project, and audits team.project_assigned", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, managerId: MANAGER_ID });
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID });
    db.teamProject.upsert.mockResolvedValue({});
    db.teamMembership.findMany.mockResolvedValue([
      { userId: "m1" },
      { userId: "m2" },
    ]);

    const result = await assignTeamProject({ teamId: TEAM_ID, projectId: PROJECT_ID, role: "MEMBER" });

    expect(result).toEqual({ ok: true });
    expect(db.teamProject.upsert).toHaveBeenCalledWith({
      where: { teamId_projectId: { teamId: TEAM_ID, projectId: PROJECT_ID } },
      update: { role: "MEMBER" },
      create: { teamId: TEAM_ID, projectId: PROJECT_ID, role: "MEMBER" },
    });
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, "m1");
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, "m2");
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, MANAGER_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "team.project_assigned",
          targetType: "TeamProject",
          targetId: TEAM_ID,
          metadata: { teamId: TEAM_ID, projectId: PROJECT_ID, role: "MEMBER" },
        }),
      }),
    );
  });

  it("does not double-recompute when the team has no manager", async () => {
    db.team.findUnique.mockResolvedValue({ id: TEAM_ID, managerId: null });
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID });
    db.teamProject.upsert.mockResolvedValue({});
    db.teamMembership.findMany.mockResolvedValue([{ userId: "m1" }]);

    const result = await assignTeamProject({ teamId: TEAM_ID, projectId: PROJECT_ID, role: "VIEWER" });

    expect(result).toEqual({ ok: true });
    expect(mockRecomputeMembership).toHaveBeenCalledTimes(1);
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, "m1");
  });
});

describe("updateTeamProjectRole", () => {
  it("requires admin — non-admin gets ok:false", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await updateTeamProjectRole({ teamId: TEAM_ID, projectId: PROJECT_ID, role: "MANAGER" });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.teamProject.update).not.toHaveBeenCalled();
  });

  it("returns not-found when the team isn't assigned to that project", async () => {
    db.teamProject.findUnique.mockResolvedValue(null);

    const result = await updateTeamProjectRole({ teamId: TEAM_ID, projectId: PROJECT_ID, role: "MANAGER" });

    expect(result).toEqual({ ok: false, error: "This team isn't assigned to that project." });
    expect(db.teamProject.update).not.toHaveBeenCalled();
  });

  it("is idempotent when the requested role matches the existing role", async () => {
    db.teamProject.findUnique.mockResolvedValue({ role: "MEMBER" });

    const result = await updateTeamProjectRole({ teamId: TEAM_ID, projectId: PROJECT_ID, role: "MEMBER" });

    expect(result).toEqual({ ok: true });
    expect(db.teamProject.update).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
  });

  it("changes the role, recomputes the team's members+manager for that project, and audits team.project_role_changed with from/to", async () => {
    db.teamProject.findUnique.mockResolvedValue({ role: "MEMBER" });
    db.teamProject.update.mockResolvedValue({});
    db.team.findUnique.mockResolvedValue({ managerId: MANAGER_ID });
    db.teamMembership.findMany.mockResolvedValue([{ userId: "m1" }]);

    const result = await updateTeamProjectRole({ teamId: TEAM_ID, projectId: PROJECT_ID, role: "MANAGER" });

    expect(result).toEqual({ ok: true });
    expect(db.teamProject.update).toHaveBeenCalledWith({
      where: { teamId_projectId: { teamId: TEAM_ID, projectId: PROJECT_ID } },
      data: { role: "MANAGER" },
    });
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, "m1");
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, MANAGER_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "team.project_role_changed",
          targetType: "TeamProject",
          targetId: TEAM_ID,
          metadata: { teamId: TEAM_ID, projectId: PROJECT_ID, from: "MEMBER", to: "MANAGER" },
        }),
      }),
    );
  });
});

describe("unassignTeamProject", () => {
  it("requires admin — non-admin gets ok:false", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await unassignTeamProject({ teamId: TEAM_ID, projectId: PROJECT_ID });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.teamProject.delete).not.toHaveBeenCalled();
  });

  it("is idempotent when the team isn't assigned to that project", async () => {
    db.teamProject.findUnique.mockResolvedValue(null);

    const result = await unassignTeamProject({ teamId: TEAM_ID, projectId: PROJECT_ID });

    expect(result).toEqual({ ok: true });
    expect(db.teamProject.delete).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("CRITICAL: captures the team's members+manager BEFORE deleting, then recomputes each captured user for that project, and audits team.project_unassigned", async () => {
    db.teamProject.findUnique.mockResolvedValue({ role: "MEMBER" });
    db.team.findUnique.mockResolvedValue({ managerId: MANAGER_ID });
    db.teamMembership.findMany.mockResolvedValue([
      { userId: "m1" },
      { userId: "m2" },
    ]);
    db.teamProject.delete.mockResolvedValue({});

    const result = await unassignTeamProject({ teamId: TEAM_ID, projectId: PROJECT_ID });

    expect(result).toEqual({ ok: true });
    expect(db.teamProject.delete).toHaveBeenCalledWith({
      where: { teamId_projectId: { teamId: TEAM_ID, projectId: PROJECT_ID } },
    });
    // These users are no longer in the team's post-mutation derivation set for
    // this project — recomputeMembership must be called for each of them
    // explicitly so any TeamProject-derived access they held is stripped.
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, "m1");
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, "m2");
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, MANAGER_ID);
    // The capture (team + members lookup) must happen before the delete so the
    // pre-mutation set is used, not a truncated post-delete one.
    const teamLookupOrder = db.team.findUnique.mock.invocationCallOrder[0];
    const deleteOrder = db.teamProject.delete.mock.invocationCallOrder[0];
    expect(teamLookupOrder).toBeLessThan(deleteOrder);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "team.project_unassigned",
          targetType: "TeamProject",
          targetId: TEAM_ID,
          metadata: { teamId: TEAM_ID, projectId: PROJECT_ID, role: "MEMBER" },
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Project leads (Teams Org Foundation, Task B3) — multi-lead management.
// Lead access = MANAGER on the project (recomputeMembership treats
// `leadId === user OR a ProjectLead row` as a MANAGER source).
// ─────────────────────────────────────────────────────────────────────────────

const OLD_PRIMARY_ID = "old-primary-1";

describe("addProjectLead", () => {
  it("requires admin — non-admin gets ok:false and never touches the DB", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await addProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.projectLead.upsert).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns not-found when the project doesn't exist", async () => {
    db.project.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ id: USER_ID, status: "ACTIVE" });

    const result = await addProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "Project not found." });
    expect(db.projectLead.upsert).not.toHaveBeenCalled();
  });

  it("returns not-found when the target user doesn't exist", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, leadId: OLD_PRIMARY_ID });
    db.user.findUnique.mockResolvedValue(null);

    const result = await addProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "User not found." });
    expect(db.projectLead.upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-ACTIVE target user", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, leadId: OLD_PRIMARY_ID });
    db.user.findUnique.mockResolvedValue({ id: USER_ID, status: "SUSPENDED" });

    const result = await addProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "Lead must be an active user." });
    expect(db.projectLead.upsert).not.toHaveBeenCalled();
  });

  it("upserts the ProjectLead row (idempotent), calls recomputeMembership, and audits lead.added", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, leadId: OLD_PRIMARY_ID });
    db.user.findUnique.mockResolvedValue({ id: USER_ID, status: "ACTIVE" });
    db.projectLead.upsert.mockResolvedValue({});

    const result = await addProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.projectLead.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
      update: {},
      create: { projectId: PROJECT_ID, userId: USER_ID },
    });
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, USER_ID);
    // recompute must run AFTER the upsert so it sees the just-written lead row.
    const upsertOrder = db.projectLead.upsert.mock.invocationCallOrder[0];
    const recomputeOrder = mockRecomputeMembership.mock.invocationCallOrder[0];
    expect(upsertOrder).toBeLessThan(recomputeOrder);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "lead.added",
          targetType: "ProjectLead",
          targetId: USER_ID,
          metadata: { projectId: PROJECT_ID, userId: USER_ID },
        }),
      }),
    );
  });
});

describe("removeProjectLead", () => {
  it("requires admin — non-admin gets ok:false and never touches the DB", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await removeProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.projectLead.delete).not.toHaveBeenCalled();
  });

  it("returns not-found when the project doesn't exist", async () => {
    db.project.findUnique.mockResolvedValue(null);

    const result = await removeProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "Project not found." });
    expect(db.projectLead.delete).not.toHaveBeenCalled();
  });

  it("REFUSES to remove the current primary lead — no delete, no recompute", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, leadId: USER_ID });

    const result = await removeProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({
      ok: false,
      error: "Reassign the primary lead before removing them.",
    });
    expect(db.projectLead.delete).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("is idempotent when no ProjectLead row exists for a non-primary user", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, leadId: OLD_PRIMARY_ID });
    db.projectLead.findUnique.mockResolvedValue(null);

    const result = await removeProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.projectLead.delete).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("removes a co-lead: deletes the ProjectLead row, recomputes them, and audits lead.removed", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, leadId: OLD_PRIMARY_ID });
    db.projectLead.findUnique.mockResolvedValue({ id: "lead-row-1" });
    db.projectLead.delete.mockResolvedValue({});

    const result = await removeProjectLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.projectLead.delete).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
    });
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, USER_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "lead.removed",
          targetType: "ProjectLead",
          targetId: USER_ID,
          metadata: { projectId: PROJECT_ID, userId: USER_ID },
        }),
      }),
    );
  });
});

describe("setPrimaryLead", () => {
  it("requires admin — non-admin gets ok:false and never touches the DB", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await setPrimaryLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "You don't have permission to do that." });
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it("returns not-found when the project doesn't exist", async () => {
    db.project.findUnique.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ id: USER_ID, status: "ACTIVE" });

    const result = await setPrimaryLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "Project not found." });
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it("returns not-found when the target user doesn't exist", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, leadId: OLD_PRIMARY_ID });
    db.user.findUnique.mockResolvedValue(null);

    const result = await setPrimaryLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: false, error: "User not found." });
    expect(db.project.update).not.toHaveBeenCalled();
  });

  it("is idempotent when the target is already the primary lead", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, leadId: USER_ID });
    db.user.findUnique.mockResolvedValue({ id: USER_ID, status: "ACTIVE" });

    const result = await setPrimaryLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.project.update).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("ensures a ProjectLead row for the new primary, updates Project.leadId, recomputes BOTH old and new primary, and audits lead.primary_changed with from/to", async () => {
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, leadId: OLD_PRIMARY_ID });
    db.user.findUnique.mockResolvedValue({ id: USER_ID, status: "ACTIVE" });
    db.projectLead.upsert.mockResolvedValue({});
    db.project.update.mockResolvedValue({});

    const result = await setPrimaryLead({ projectId: PROJECT_ID, userId: USER_ID });

    expect(result).toEqual({ ok: true });
    expect(db.projectLead.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
      update: {},
      create: { projectId: PROJECT_ID, userId: USER_ID },
    });
    expect(db.project.update).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { leadId: USER_ID },
    });
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, OLD_PRIMARY_ID);
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, PROJECT_ID, USER_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: ACTOR.id,
          action: "lead.primary_changed",
          targetType: "Project",
          targetId: PROJECT_ID,
          metadata: { projectId: PROJECT_ID, from: OLD_PRIMARY_ID, to: USER_ID },
        }),
      }),
    );
  });
});
