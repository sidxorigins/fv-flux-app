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

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    user: model(),
    project: model(),
    projectMembership: model(),
    auditLog: model(),
  };
  prisma.$transaction = vi.fn();
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { createProject } from "./actions";

interface MockModel {
  findUnique: Mock;
  create: Mock;
  createMany: Mock;
}
const db = prisma as unknown as {
  user: MockModel;
  project: MockModel;
  projectMembership: MockModel;
  auditLog: MockModel;
  $transaction: Mock;
};
const mockRequireUser = requireUser as unknown as Mock;

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
  db.auditLog.create.mockResolvedValue({});
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
    // Exactly one MANAGER membership (creator == lead, deduped).
    const membershipArg = db.projectMembership.createMany.mock.calls[0][0];
    expect(membershipArg.data).toEqual([
      { projectId: "p-1", userId: CREATOR.id, projectRole: "MANAGER" },
    ]);
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
      { projectId: "p-1", userId: ADMIN.id, projectRole: "MANAGER" },
      { projectId: "p-1", userId: "u-lead", projectRole: "MANAGER" },
    ]);
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
