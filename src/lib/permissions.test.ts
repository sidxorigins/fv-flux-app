import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projectMembership: { findUnique: vi.fn() },
    team: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  PROJECT_ROLE_ORDER,
  canEditTasks,
  canManageProject,
  canManageProjectLeads,
  canManageTeam,
  canViewProject,
  getProjectRole,
  isManagerOfAnyTeam,
  managedTeamIds,
  requireAdmin,
  requireProjectRole,
  requireTeamManage,
  requireUser,
} from "./permissions";
import type { User } from "@/generated/prisma/client";

const mockAuth = auth as unknown as Mock;
const mockFindUser = prisma.user.findUnique as unknown as Mock;
const mockFindMembership = prisma.projectMembership.findUnique as unknown as Mock;
const mockFindTeam = prisma.team.findUnique as unknown as Mock;
const mockFindManyTeams = prisma.team.findMany as unknown as Mock;
const mockCountTeams = prisma.team.count as unknown as Mock;

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

describe("canManageTeam", () => {
  it("is true for a global ADMIN, regardless of team ownership", async () => {
    mockFindUser.mockResolvedValue({ globalRole: "ADMIN" });
    await expect(canManageTeam("admin-1", "team-1")).resolves.toBe(true);
    // Admin short-circuits — the team table must not even be queried.
    expect(mockFindTeam).not.toHaveBeenCalled();
  });

  it("is true when the user is the team's managerId", async () => {
    mockFindUser.mockResolvedValue({ globalRole: "USER" });
    mockFindTeam.mockResolvedValue({ managerId: "user-1" });
    await expect(canManageTeam("user-1", "team-1")).resolves.toBe(true);
  });

  it("is false for a non-admin, non-manager user", async () => {
    mockFindUser.mockResolvedValue({ globalRole: "USER" });
    mockFindTeam.mockResolvedValue({ managerId: "someone-else" });
    await expect(canManageTeam("user-1", "team-1")).resolves.toBe(false);
  });

  it("is false when the team does not exist", async () => {
    mockFindUser.mockResolvedValue({ globalRole: "USER" });
    mockFindTeam.mockResolvedValue(null);
    await expect(canManageTeam("user-1", "team-1")).resolves.toBe(false);
  });
});

describe("requireTeamManage", () => {
  it("returns the user for a global ADMIN without checking the team's manager", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1" } });
    const admin = makeUser({ id: "admin-1", globalRole: "ADMIN" });
    mockFindUser.mockResolvedValue(admin);
    await expect(requireTeamManage("team-1")).resolves.toEqual(admin);
    expect(mockFindTeam).not.toHaveBeenCalled();
  });

  it("returns the user when they are the team's manager", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    const manager = makeUser({ id: "user-1", globalRole: "USER" });
    mockFindUser.mockResolvedValue(manager);
    mockFindTeam.mockResolvedValue({ managerId: "user-1" });
    await expect(requireTeamManage("team-1")).resolves.toEqual(manager);
  });

  it("throws AuthorizationError(FORBIDDEN) for a non-manager, non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ id: "user-1", globalRole: "USER" }));
    mockFindTeam.mockResolvedValue({ managerId: "someone-else" });
    await expectAuthError(requireTeamManage("team-1"), "FORBIDDEN");
  });

  it("throws AuthorizationError(FORBIDDEN) when the team does not exist", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockFindUser.mockResolvedValue(makeUser({ id: "user-1", globalRole: "USER" }));
    mockFindTeam.mockResolvedValue(null);
    await expectAuthError(requireTeamManage("team-1"), "FORBIDDEN");
  });
});

describe("managedTeamIds", () => {
  it("returns only the ids of teams the user manages", async () => {
    mockFindManyTeams.mockResolvedValue([{ id: "team-1" }, { id: "team-2" }]);
    await expect(managedTeamIds("user-1")).resolves.toEqual(["team-1", "team-2"]);
    expect(mockFindManyTeams).toHaveBeenCalledWith({
      where: { managerId: "user-1" },
      select: { id: true },
    });
  });

  it("returns an empty array when the user manages no teams", async () => {
    mockFindManyTeams.mockResolvedValue([]);
    await expect(managedTeamIds("user-1")).resolves.toEqual([]);
  });
});

describe("isManagerOfAnyTeam", () => {
  it("is true when the user manages at least one team", async () => {
    mockCountTeams.mockResolvedValue(1);
    await expect(isManagerOfAnyTeam("user-1")).resolves.toBe(true);
  });

  it("is true when the user manages several teams", async () => {
    mockCountTeams.mockResolvedValue(3);
    await expect(isManagerOfAnyTeam("user-1")).resolves.toBe(true);
  });

  it("is false when the user manages no teams", async () => {
    mockCountTeams.mockResolvedValue(0);
    await expect(isManagerOfAnyTeam("user-1")).resolves.toBe(false);
  });
});

describe("canManageProjectLeads", () => {
  it("is true for a global ADMIN", () => {
    const admin = makeUser({ globalRole: "ADMIN" });
    expect(canManageProjectLeads(admin)).toBe(true);
  });

  it("is false for a regular USER", () => {
    const user = makeUser({ globalRole: "USER" });
    expect(canManageProjectLeads(user)).toBe(false);
  });
});
