// Password-reset action tests. Mocking mirrors admin/actions.test.ts: @/lib/db
// is a hand-rolled mock whose `prisma.x` and the `tx` given to `$transaction`
// are the SAME object, so assertions read off one place.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

// actions.ts imports `signIn` from "@/lib/auth" and `AuthError` from
// "next-auth" directly (both for loginAction, untouched here). Unmocked,
// either pulls in the real next-auth package, whose ESM build imports
// "next/server" without an extension — which fails to resolve under Node/
// Vitest given this repo's installed next 16 (no "exports" map) + next-auth
// beta combination, independent of anything in this feature. Every other
// test file that touches @/lib/auth (e.g. lib/permissions.test.ts) mocks it
// out for the same reason; none of the three actions under test call signIn
// or throw a real next-auth AuthError.
vi.mock("@/lib/auth", () => ({
  signIn: vi.fn(),
}));

vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));

vi.mock("@/lib/mail", () => ({
  sendPasswordResetEmail: vi.fn(async () => ({ sent: true })),
}));

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    user: model(),
    passwordResetToken: model(),
    auditLog: model(),
  };
  prisma.$transaction = vi.fn();
  return { prisma };
});

import { prisma } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/mail";
import { hashToken } from "@/lib/tokens";
import {
  requestPasswordReset,
  resetPassword,
  validateResetToken,
} from "./actions";

const db = prisma as unknown as {
  user: Record<string, Mock>;
  passwordResetToken: Record<string, Mock>;
  auditLog: Record<string, Mock>;
  $transaction: Mock;
};

const ACTIVE_USER = {
  id: "user_1",
  email: "user@company.com",
  status: "ACTIVE",
  hashedPassword: "$2a$12$existinghash",
};

// The rate limiter keys on the email and its bucket map is module-level state
// that vi.clearAllMocks() does NOT reset. Every case that calls
// requestPasswordReset therefore uses its own address, or the 3/hour limit
// leaks across tests and fails whichever one happens to run fourth.

function futureDate(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Run the transaction callback against the same mock object as `prisma`.
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
});

describe("requestPasswordReset", () => {
  it("issues and mails a token for an ACTIVE user", async () => {
    db.user.findUnique.mockResolvedValue(ACTIVE_USER);
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    db.passwordResetToken.create.mockResolvedValue({ id: "tok_1" });

    const result = await requestPasswordReset({ email: "issue@company.com" });

    expect(result.ok).toBe(true);
    expect(db.passwordResetToken.create).toHaveBeenCalledTimes(1);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);

    // The raw token must never be persisted — only its hash.
    const created = db.passwordResetToken.create.mock.calls[0][0].data;
    const mailed = (sendPasswordResetEmail as Mock).mock.calls[0][0].resetUrl;
    const rawToken = new URL(mailed).searchParams.get("token")!;
    expect(rawToken).toBeTruthy();
    expect(created.tokenHash).toBe(hashToken(rawToken));
    expect(created.tokenHash).not.toBe(rawToken);
  });

  it("invalidates outstanding tokens before issuing a new one", async () => {
    db.user.findUnique.mockResolvedValue(ACTIVE_USER);
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    db.passwordResetToken.create.mockResolvedValue({ id: "tok_2" });

    await requestPasswordReset({ email: "outstanding@company.com" });

    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user_1", usedAt: null }),
      }),
    );
  });

  it("returns the same result for an unregistered email and sends nothing", async () => {
    db.user.findUnique.mockResolvedValue(null);

    const known = { ok: true };
    const result = await requestPasswordReset({ email: "nobody@company.com" });

    expect(result).toEqual(known);
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns the same result for a SUSPENDED user and sends nothing", async () => {
    db.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, status: "SUSPENDED" });

    const result = await requestPasswordReset({ email: "suspended@company.com" });

    expect(result.ok).toBe(true);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns the same result for an SSO-only user with no password", async () => {
    db.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, hashedPassword: null });

    const result = await requestPasswordReset({ email: "sso@company.com" });

    expect(result.ok).toBe(true);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("rate-limits repeated requests for the same email", async () => {
    db.user.findUnique.mockResolvedValue(ACTIVE_USER);
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    db.passwordResetToken.create.mockResolvedValue({ id: "tok_3" });

    const email = "ratelimit@company.com";
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await requestPasswordReset({ email }));
    }

    expect(results.some((r) => !r.ok)).toBe(true);
  });
});

describe("validateResetToken", () => {
  it("accepts an unused, unexpired token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: futureDate(30),
      user: { status: "ACTIVE" },
    });

    expect(await validateResetToken("raw")).toEqual({ valid: true });
  });

  it("rejects an expired token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      user: { status: "ACTIVE" },
    });

    expect(await validateResetToken("raw")).toEqual({ valid: false });
  });

  it("rejects an already-used token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      usedAt: new Date(),
      expiresAt: futureDate(30),
      user: { status: "ACTIVE" },
    });

    expect(await validateResetToken("raw")).toEqual({ valid: false });
  });

  it("rejects an unknown token without hitting the DB twice", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(null);

    expect(await validateResetToken("raw")).toEqual({ valid: false });
    expect(db.passwordResetToken.findUnique).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty token without touching the DB", async () => {
    expect(await validateResetToken("")).toEqual({ valid: false });
    expect(db.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  // Distinct token per case, for the same reason as the emails above: the
  // per-token limiter (5 / 15 min) is module-level state that survives
  // clearAllMocks, and a shared token would put these cases exactly on its
  // boundary.
  const input = (id: string) => ({
    token: `raw-token-${id}`,
    password: "newpassword1",
  });

  it("rewrites the password, stamps passwordChangedAt, and burns the token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: futureDate(30),
      user: ACTIVE_USER,
    });
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    db.user.update.mockResolvedValue(ACTIVE_USER);
    db.auditLog.create.mockResolvedValue({});

    const result = await resetPassword(input("happy"));

    expect(result.ok).toBe(true);

    const userUpdate = db.user.update.mock.calls[0][0];
    expect(userUpdate.where).toEqual({ id: "user_1" });
    expect(userUpdate.data.hashedPassword).toMatch(/^\$2[aby]\$12\$/);
    expect(userUpdate.data.passwordChangedAt).toBeInstanceOf(Date);

    // The token is burned with a guard on usedAt so a concurrent redemption
    // cannot also win.
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "tok_1", usedAt: null }),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rejects an expired token without writing anything", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      user: ACTIVE_USER,
    });

    const result = await resetPassword(input("expired"));

    expect(result.ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects an already-used token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: new Date(),
      expiresAt: futureDate(30),
      user: ACTIVE_USER,
    });

    const result = await resetPassword(input("used"));

    expect(result.ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects a token whose user is no longer ACTIVE", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: futureDate(30),
      user: { ...ACTIVE_USER, status: "SUSPENDED" },
    });

    const result = await resetPassword(input("suspended"));

    expect(result.ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects a password that fails the policy", async () => {
    const result = await resetPassword({ token: "raw-token-weak", password: "short" });

    expect(result.ok).toBe(false);
    expect(db.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("loses the race when a concurrent redemption burns the token first", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: "tok_1",
      userId: "user_1",
      usedAt: null,
      expiresAt: futureDate(30),
      user: ACTIVE_USER,
    });
    // The guarded updateMany matches nothing — someone else already used it.
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

    const result = await resetPassword(input("race"));

    expect(result.ok).toBe(false);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
