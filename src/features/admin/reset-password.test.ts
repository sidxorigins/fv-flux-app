// Tests for the admin-issued password reset. Mocking mirrors
// admin/actions.test.ts: @/lib/db is a hand-rolled mock, @/lib/permissions is a
// lightweight stand-in, and the token issuer is mocked so these assert the
// action's authorisation, guards, and audit trail — not the issuer, which has
// its own coverage via the public flow.

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
    requireAdmin: vi.fn(),
    requireProjectRole: vi.fn(),
    requireTeamManage: vi.fn(),
  };
});

vi.mock("@/lib/access-sync", () => ({
  recomputeMembership: vi.fn(),
  recomputeForTeam: vi.fn(),
}));

vi.mock("@/lib/mail", () => ({
  sendInviteEmail: vi.fn(async () => ({ sent: true })),
  sendPasswordResetEmail: vi.fn(async () => ({ sent: true })),
}));

vi.mock("@/features/auth/reset-tokens", () => ({
  RESET_TOKEN_TTL_MINUTES: 60,
  issuePasswordResetToken: vi.fn(
    async () => "https://flux.example/reset-password?token=raw",
  ),
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
import { AuthorizationError, requireAdmin } from "@/lib/permissions";
import { sendPasswordResetEmail } from "@/lib/mail";
import { issuePasswordResetToken } from "@/features/auth/reset-tokens";
import { adminResetPassword } from "./actions";

const db = prisma as unknown as {
  user: Record<string, Mock>;
  auditLog: Record<string, Mock>;
};
const mockRequireAdmin = requireAdmin as unknown as Mock;

const ADMIN = { id: "admin-1", username: "adminuser", globalRole: "ADMIN" };
const TARGET = {
  id: "user-1",
  email: "user@company.com",
  status: "ACTIVE",
  hashedPassword: "$2a$12$existing",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(ADMIN);
});

describe("adminResetPassword", () => {
  it("issues a link, mails it, and returns the URL for out-of-band delivery", async () => {
    db.user.findUnique.mockResolvedValue(TARGET);
    db.auditLog.create.mockResolvedValue({});

    const result = await adminResetPassword({ userId: "user-1" });

    expect(result).toEqual({
      ok: true,
      data: {
        resetUrl: "https://flux.example/reset-password?token=raw",
        emailSent: true,
      },
    });
    expect(issuePasswordResetToken).toHaveBeenCalledWith("user-1");
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@company.com", expiresInMinutes: 60 }),
    );
  });

  it("still returns the link when the email could not be sent", async () => {
    db.user.findUnique.mockResolvedValue(TARGET);
    db.auditLog.create.mockResolvedValue({});
    (sendPasswordResetEmail as Mock).mockResolvedValueOnce({
      sent: false,
      reason: "smtp-unconfigured",
    });

    const result = await adminResetPassword({ userId: "user-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.emailSent).toBe(false);
      expect(result.data?.resetUrl).toContain("/reset-password?token=");
    }
  });

  it("writes an audit entry that never contains the token or URL", async () => {
    db.user.findUnique.mockResolvedValue(TARGET);
    db.auditLog.create.mockResolvedValue({});

    await adminResetPassword({ userId: "user-1" });

    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const entry = db.auditLog.create.mock.calls[0][0].data;
    expect(entry).toMatchObject({
      actorId: "admin-1",
      action: "user.password_reset_link_issued",
      targetType: "User",
      targetId: "user-1",
    });
    expect(JSON.stringify(entry)).not.toContain("token=");
    expect(JSON.stringify(entry)).not.toContain("raw");
  });

  it("refuses a non-admin", async () => {
    mockRequireAdmin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));

    const result = await adminResetPassword({ userId: "user-1" });

    expect(result.ok).toBe(false);
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("refuses an unknown user", async () => {
    db.user.findUnique.mockResolvedValue(null);

    const result = await adminResetPassword({ userId: "nope" });

    expect(result).toEqual({ ok: false, error: "User not found." });
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
  });

  it("points an INVITED user at the invite flow instead", async () => {
    db.user.findUnique.mockResolvedValue({
      ...TARGET,
      status: "INVITED",
      hashedPassword: null,
    });

    const result = await adminResetPassword({ userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invite/i);
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
  });

  it("refuses a SUSPENDED user — a reset link would be unusable anyway", async () => {
    db.user.findUnique.mockResolvedValue({ ...TARGET, status: "SUSPENDED" });

    const result = await adminResetPassword({ userId: "user-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reactivate/i);
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
  });

  it("refuses an account with no password login", async () => {
    db.user.findUnique.mockResolvedValue({ ...TARGET, hashedPassword: null });

    const result = await adminResetPassword({ userId: "user-1" });

    expect(result.ok).toBe(false);
    expect(issuePasswordResetToken).not.toHaveBeenCalled();
  });

  it("rejects malformed input before touching the DB", async () => {
    const result = await adminResetPassword({ userId: "" });

    expect(result).toEqual({ ok: false, error: "Invalid input." });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});
