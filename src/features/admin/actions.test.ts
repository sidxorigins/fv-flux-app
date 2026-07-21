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
  };
  prisma.$transaction = vi.fn();
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireProjectRole } from "@/lib/permissions";
import { recomputeMembership } from "@/lib/access-sync";
import { addProjectMember, removeProjectMember, updateProjectMember } from "./actions";

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
  $transaction: Mock;
}

const db = prisma as unknown as MockPrisma;
const mockRequireProjectRole = requireProjectRole as unknown as Mock;
const mockRecomputeMembership = recomputeMembership as unknown as Mock;

const ACTOR = { id: "actor-1", globalRole: "ADMIN" };
const PROJECT_ID = "proj-1";
const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  // Every actions.ts call site does `prisma.$transaction(async (tx) => ...)` —
  // hand the callback the same mock object so `tx.x` === `prisma.x`.
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db));
  mockRequireProjectRole.mockResolvedValue({ user: ACTOR, role: "MANAGER" });
  db.auditLog.create.mockResolvedValue({});
  mockRecomputeMembership.mockResolvedValue(undefined);
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
