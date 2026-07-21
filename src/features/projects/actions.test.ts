// Focused tests for the createProject authorisation rules that changed when
// project creation became self-service: ANY active user may create a project and
// becomes its lead + MANAGER, while only a global Admin may hand the lead to
// someone else. The transaction body itself (audit entry, membership rows) is
// exercised through the same mock `tx` the task-actions suite uses.
//
// Mocking approach mirrors ./actions counterpart in tasks/: @/lib/db is a
// hand-rolled mock where `prisma.x` and the `tx` in `$transaction` are the SAME
// object; @/lib/permissions is a lightweight stand-in so `requireUser` /
// `requireAdmin` are controllable and the real `AuthorizationError` instanceof
// check in `mapAuthError` still works.

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
    requireUser: vi.fn(),
    requireAdmin: vi.fn(),
    requireProjectRole: vi.fn(),
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
    createMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    user: model(),
    project: model(),
    projectMembership: model(),
    projectLead: model(),
    auditLog: model(),
  };
  prisma.$transaction = vi.fn();
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireUser, requireProjectRole } from "@/lib/permissions";
import { recomputeMembership } from "@/lib/access-sync";
import { createProject, updateProject } from "./actions";

interface MockModel {
  findUnique: Mock;
  create: Mock;
  createMany: Mock;
  update: Mock;
  upsert: Mock;
  delete: Mock;
}
const db = prisma as unknown as {
  user: MockModel;
  project: MockModel;
  projectMembership: MockModel;
  projectLead: MockModel;
  auditLog: MockModel;
  $transaction: Mock;
};
const mockRequireUser = requireUser as unknown as Mock;
const mockRequireProjectRole = requireProjectRole as unknown as Mock;
const mockRecomputeMembership = recomputeMembership as unknown as Mock;

const CREATOR = { id: "u-creator", globalRole: "USER", status: "ACTIVE" };
const ADMIN = { id: "u-admin", globalRole: "ADMIN", status: "ACTIVE" };
const VALID = { key: "ops", name: "Operations", description: "" };

beforeEach(() => {
  vi.clearAllMocks();
  // Fake $transaction: run the callback with the shared prisma mock as `tx`.
  db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb(db),
  );
  db.project.create.mockResolvedValue({ id: "p-1", key: "OPS" });
  db.projectMembership.createMany.mockResolvedValue({ count: 1 });
  db.projectLead.create.mockResolvedValue({});
  db.projectLead.upsert.mockResolvedValue({});
  db.auditLog.create.mockResolvedValue({});
  mockRecomputeMembership.mockResolvedValue(undefined);
});

describe("createProject authorisation", () => {
  it("lets a non-admin create a project — creator becomes lead + sole MANAGER", async () => {
    mockRequireUser.mockResolvedValue(CREATOR);

    const res = await createProject(VALID);

    expect(res).toEqual({ ok: true, data: { id: "p-1", key: "OPS" } });
    // Lead resolves to the creator; no lead-existence lookup needed.
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadId: CREATOR.id }),
      }),
    );
    // Exactly one MANAGER membership (creator == lead, deduped). manualRole is
    // set so recomputeMembership never deletes this structural grant later.
    const membershipArg = db.projectMembership.createMany.mock.calls[0][0];
    expect(membershipArg.data).toEqual([
      {
        projectId: "p-1",
        userId: CREATOR.id,
        projectRole: "MANAGER",
        manualRole: "MANAGER",
      },
    ]);
    // Primary lead tracked in ProjectLead, same as backfilled projects.
    expect(db.projectLead.create).toHaveBeenCalledWith({
      data: { projectId: "p-1", userId: CREATOR.id },
    });
  });

  it("ignores a leadId a non-admin tries to assign — they always lead their own project", async () => {
    mockRequireUser.mockResolvedValue(CREATOR);

    const res = await createProject({ ...VALID, leadId: "someone-else" });

    expect(res.ok).toBe(true);
    // Non-admin: resolvedLeadId is forced to the creator, so no other-user lookup.
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadId: CREATOR.id }),
      }),
    );
  });

  it("lets an admin assign a different lead — both creator and lead get MANAGER", async () => {
    mockRequireUser.mockResolvedValue(ADMIN);
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE" });

    const res = await createProject({ ...VALID, leadId: "u-lead" });

    expect(res.ok).toBe(true);
    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u-lead" } }),
    );
    expect(db.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leadId: "u-lead" }),
      }),
    );
    const membershipArg = db.projectMembership.createMany.mock.calls[0][0];
    expect(membershipArg.data).toEqual([
      {
        projectId: "p-1",
        userId: ADMIN.id,
        projectRole: "MANAGER",
        manualRole: "MANAGER",
      },
      {
        projectId: "p-1",
        userId: "u-lead",
        projectRole: "MANAGER",
        manualRole: "MANAGER",
      },
    ]);
    // Primary lead (the assigned lead, not the admin creator) tracked in ProjectLead.
    expect(db.projectLead.create).toHaveBeenCalledWith({
      data: { projectId: "p-1", userId: "u-lead" },
    });
  });

  it("rejects an admin-assigned lead that is not an active user", async () => {
    mockRequireUser.mockResolvedValue(ADMIN);
    db.user.findUnique.mockResolvedValue({ status: "SUSPENDED" });

    const res = await createProject({ ...VALID, leadId: "u-suspended" });

    expect(res.ok).toBe(false);
    expect(db.project.create).not.toHaveBeenCalled();
  });

  it("rejects invalid input before any auth or DB work", async () => {
    const res = await createProject({ key: "x", name: "" });

    expect(res.ok).toBe(false);
    expect(mockRequireUser).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateProject — lead-change branch now routes through access-sync instead of
// ad-hoc membership writes (same approach as admin/actions.ts's setPrimaryLead):
// ensure a ProjectLead row for the new lead, then recompute BOTH the new and
// the former primary so stale MANAGER-derived access is stripped, not left
// stale on the former lead.
// ─────────────────────────────────────────────────────────────────────────────

const OLD_LEAD_ID = "u-old-lead";
const NEW_LEAD_ID = "u-new-lead";
const MANAGER = { id: "u-manager", globalRole: "USER", status: "ACTIVE" };

describe("updateProject lead change", () => {
  beforeEach(() => {
    mockRequireProjectRole.mockResolvedValue({ user: MANAGER, role: "MANAGER" });
    db.project.findUnique.mockResolvedValue({ id: "p-1", leadId: OLD_LEAD_ID });
    db.project.update.mockResolvedValue({});
  });

  it("validates the new lead is ACTIVE before making any changes", async () => {
    db.user.findUnique.mockResolvedValue({ status: "SUSPENDED" });

    const res = await updateProject("p-1", { leadId: NEW_LEAD_ID });

    expect(res.ok).toBe(false);
    expect(db.projectLead.upsert).not.toHaveBeenCalled();
    expect(db.project.update).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
  });

  it("ensures a ProjectLead row for the new lead, updates Project.leadId, and recomputes BOTH the new and former lead", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE" });

    const res = await updateProject("p-1", { leadId: NEW_LEAD_ID });

    expect(res).toEqual({ ok: true, data: { id: "p-1" } });
    expect(db.projectLead.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: "p-1", userId: NEW_LEAD_ID } },
      update: {},
      create: { projectId: "p-1", userId: NEW_LEAD_ID },
    });
    expect(db.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p-1" },
        data: expect.objectContaining({ leadId: NEW_LEAD_ID }),
      }),
    );
    // No ad-hoc membership create — access-sync owns the effective-role write.
    expect(db.projectMembership.create).not.toHaveBeenCalled();
    expect(db.projectMembership.findUnique).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, "p-1", NEW_LEAD_ID);
    expect(mockRecomputeMembership).toHaveBeenCalledWith(db, "p-1", OLD_LEAD_ID);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "project.lead_changed",
          targetType: "Project",
          targetId: "p-1",
          metadata: { from: OLD_LEAD_ID, to: NEW_LEAD_ID },
        }),
      }),
    );
  });

  it("does not touch leads or call recomputeMembership when leadId is unchanged", async () => {
    const res = await updateProject("p-1", { name: "Renamed" });

    expect(res.ok).toBe(true);
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.projectLead.upsert).not.toHaveBeenCalled();
    expect(mockRecomputeMembership).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
