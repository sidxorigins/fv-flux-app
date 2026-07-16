import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projectMembership: { findUnique: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  PROJECT_ROLE_ORDER,
  canEditTasks,
  canManageProject,
  canViewProject,
  getProjectRole,
  requireAdmin,
  requireProjectRole,
  requireUser,
} from "./permissions";
import type { User } from "@/generated/prisma/client";

const mockAuth = auth as unknown as Mock;
const mockFindUser = prisma.user.findUnique as unknown as Mock;
const mockFindMembership = prisma.projectMembership.findUnique as unknown as Mock;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    name: "Test User",
    username: "testuser",
    email: "test@example.com",
    hashedPassword: null,
    globalRole: "USER",
    status: "ACTIVE",
    bio: null,
    avatarKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

async function expectAuthError(
  promise: Promise<unknown>,
  code: "UNAUTHENTICATED" | "SUSPENDED" | "FORBIDDEN",
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AuthorizationError);
  await promise.catch((err: unknown) => {
    expect((err as AuthorizationError).code).toBe(code);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PROJECT_ROLE_ORDER", () => {
  it("orders VIEWER < MEMBER < MANAGER", () => {
    expect(PROJECT_ROLE_ORDER.VIEWER).toBeLessThan(PROJECT_ROLE_ORDER.MEMBER);
    expect(PROJECT_ROLE_ORDER.MEMBER).toBeLessThan(PROJECT_ROLE_ORDER.MANAGER);
  });

  it("assigns the exact expected numeric ranks", () => {
    expect(PROJECT_ROLE_ORDER).toEqual({ VIEWER: 0, MEMBER: 1, MANAGER: 2 });
  });
});

describe("requireUser", () => {
  it("throws UNAUTHENTICATED when there is no session", async () => {
    mockAuth.mockResolvedValue(null);
    await expectAuthError(requireUser(), "UNAUTHENTICATED");
    expect(mockFindUser).not.toHaveBeenCalled();
  });

  it("throws UNAUTHENTICATED when the session has no user id", async () => {
    mockAuth.mockResolvedValue({ user: {} });
    await expectAuthError(requireUser(), "UNAUTHENTICATED");
  });

  it("throws UNAUTHENTICATED when the session user no longer exists in the DB", async () => {
    mockAuth.mockResolvedValue({ user: { id: "ghost" } });
    mockFindUser.mockResolvedValue(null);
    await expectAuthError(requireUser(), "UNAUTHENTICATED");
  });

  it("throws SUSPENDED for a non-ACTIVE user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ status: "SUSPENDED" }));
    await expectAuthError(requireUser(), "SUSPENDED");
  });

  it("throws SUSPENDED for an INVITED (not yet activated) user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ status: "INVITED" }));
    await expectAuthError(requireUser(), "SUSPENDED");
  });

  it("returns the ACTIVE user re-fetched from the DB (not just the JWT)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    const dbUser = makeUser({ status: "ACTIVE" });
    mockFindUser.mockResolvedValue(dbUser);
    await expect(requireUser()).resolves.toEqual(dbUser);
  });
});

describe("requireAdmin", () => {
  it("rejects a regular USER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));
    await expectAuthError(requireAdmin(), "FORBIDDEN");
  });

  it("passes for a global ADMIN", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    const admin = makeUser({ globalRole: "ADMIN" });
    mockFindUser.mockResolvedValue(admin);
    await expect(requireAdmin()).resolves.toEqual(admin);
  });

  it("propagates SUSPENDED before even checking globalRole", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(
      makeUser({ globalRole: "ADMIN", status: "SUSPENDED" }),
    );
    await expectAuthError(requireAdmin(), "SUSPENDED");
  });
});

describe("getProjectRole", () => {
  it("returns null when there is no membership row", async () => {
    mockFindMembership.mockResolvedValue(null);
    await expect(getProjectRole("user-1", "proj-1")).resolves.toBeNull();
  });

  it("returns the membership's projectRole", async () => {
    mockFindMembership.mockResolvedValue({ projectRole: "MEMBER" });
    await expect(getProjectRole("user-1", "proj-1")).resolves.toBe("MEMBER");
  });
});

describe("requireProjectRole", () => {
  it("denies a VIEWER attempting a MEMBER-level action", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));
    mockFindMembership.mockResolvedValue({ projectRole: "VIEWER" });
    await expectAuthError(requireProjectRole("proj-1", "MEMBER"), "FORBIDDEN");
  });

  it("denies a MEMBER attempting a MANAGER-level action", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));
    mockFindMembership.mockResolvedValue({ projectRole: "MEMBER" });
    await expectAuthError(requireProjectRole("proj-1", "MANAGER"), "FORBIDDEN");
  });

  it("allows a MANAGER performing a MANAGER-level action", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    const user = makeUser({ globalRole: "USER" });
    mockFindUser.mockResolvedValue(user);
    mockFindMembership.mockResolvedValue({ projectRole: "MANAGER" });
    const result = await requireProjectRole("proj-1", "MANAGER");
    expect(result).toEqual({ user, role: "MANAGER" });
  });

  it("allows an exact role match at the boundary (VIEWER requesting VIEWER)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));
    mockFindMembership.mockResolvedValue({ projectRole: "VIEWER" });
    const result = await requireProjectRole("proj-1", "VIEWER");
    expect(result.role).toBe("VIEWER");
  });

  it("denies when there is no membership row at all", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));
    mockFindMembership.mockResolvedValue(null);
    await expectAuthError(requireProjectRole("proj-1", "VIEWER"), "FORBIDDEN");
  });

  it("lets a global ADMIN bypass with no membership row, reported as effective MANAGER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    const admin = makeUser({ globalRole: "ADMIN" });
    mockFindUser.mockResolvedValue(admin);
    const result = await requireProjectRole("proj-1", "MANAGER");
    expect(result).toEqual({ user: admin, role: "MANAGER" });
    // The membership table must not even be queried for a bypassing admin.
    expect(mockFindMembership).not.toHaveBeenCalled();
  });
});

describe("convenience wrappers", () => {
  it("canViewProject passes for a VIEWER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));
    mockFindMembership.mockResolvedValue({ projectRole: "VIEWER" });
    await expect(canViewProject("proj-1")).resolves.toMatchObject({ role: "VIEWER" });
  });

  it("canEditTasks denies a VIEWER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));
    mockFindMembership.mockResolvedValue({ projectRole: "VIEWER" });
    await expectAuthError(canEditTasks("proj-1"), "FORBIDDEN");
  });

  it("canManageProject denies a MEMBER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));
    mockFindMembership.mockResolvedValue({ projectRole: "MEMBER" });
    await expectAuthError(canManageProject("proj-1"), "FORBIDDEN");
  });

  it("canManageProject passes for a MANAGER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ globalRole: "USER" }));
    mockFindMembership.mockResolvedValue({ projectRole: "MANAGER" });
    await expect(canManageProject("proj-1")).resolves.toMatchObject({
      role: "MANAGER",
    });
  });
});
