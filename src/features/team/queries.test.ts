// Gate tests for the Team Productivity Visibility (#8) queries. These only
// exercise the visibility gate (does the call resolve or throw
// AuthorizationError) — not the shape of the returned productivity data,
// which is covered indirectly by shape.test.ts + manual QA. Mocking mirrors
// features/admin/actions.test.ts: @/lib/db is a hand-rolled prisma stub
// (findUnique/findMany/groupBy/aggregate per model, all vi.fn()) and
// @/lib/permissions is stubbed with a real AuthorizationError class + a
// mocked requireUser so `instanceof` checks in assertions still work.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

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
  };
});

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    team: model(),
    task: model(),
    timeEntry: model(),
    user: model(),
  };
  return { prisma };
});

import { prisma } from "@/lib/db";
import { AuthorizationError, requireUser } from "@/lib/permissions";
import { getTeamProductivity, getVisibleTeams } from "./queries";

interface MockModel {
  findUnique: Mock;
  findMany: Mock;
  groupBy: Mock;
  aggregate: Mock;
}
interface MockPrisma {
  team: MockModel;
  task: MockModel;
  timeEntry: MockModel;
  user: MockModel;
}

const db = prisma as unknown as MockPrisma;
const mockRequireUser = requireUser as unknown as Mock;

const TEAM_ID = "team-1";
const ME_ID = "me-1";
const MEMBER_ID = "member-1";
const MANAGER_ID = "manager-1";
const OTHER_ID = "other-1";

interface TeamOverrides {
  isActive?: boolean;
  managerId?: string | null;
  membersCanSeeProductivity?: boolean;
  members?: { userId: string }[];
  projects?: { projectId: string }[];
}

function baseTeam(overrides: TeamOverrides = {}) {
  return {
    id: TEAM_ID,
    name: "Kitchen Ops",
    isActive: true,
    managerId: null,
    membersCanSeeProductivity: false,
    members: [],
    // No projects → getTeamProductivity's empty-scope guard skips the
    // task/time-entry aggregate queries entirely, so the gate tests don't
    // need to shape groupBy results. The groupBy/aggregate mocks below are
    // still stubbed to safe empty defaults in case a case does exercise them.
    projects: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue({ id: ME_ID, globalRole: "USER" });
  db.user.findMany.mockResolvedValue([]);
  db.timeEntry.findMany.mockResolvedValue([]);
  db.task.groupBy.mockResolvedValue([]);
  db.timeEntry.groupBy.mockResolvedValue([]);
  db.task.aggregate.mockResolvedValue({ _sum: {} });
  db.timeEntry.aggregate.mockResolvedValue({ _sum: {} });
});

describe("getTeamProductivity — visibility gate", () => {
  it("a member of the team with membersCanSeeProductivity on can view", async () => {
    db.team.findUnique.mockResolvedValue(
      baseTeam({ members: [{ userId: ME_ID }], membersCanSeeProductivity: true }),
    );

    await expect(getTeamProductivity(TEAM_ID)).resolves.toMatchObject({
      teamId: TEAM_ID,
      teamName: "Kitchen Ops",
    });
  });

  it("a member of the team with membersCanSeeProductivity off is forbidden", async () => {
    db.team.findUnique.mockResolvedValue(
      baseTeam({ members: [{ userId: ME_ID }], membersCanSeeProductivity: false }),
    );

    await expect(getTeamProductivity(TEAM_ID)).rejects.toThrow(AuthorizationError);
  });

  it("a non-member (not manager, not admin) is forbidden even when the toggle is on", async () => {
    db.team.findUnique.mockResolvedValue(
      baseTeam({
        managerId: MANAGER_ID,
        members: [{ userId: OTHER_ID }],
        membersCanSeeProductivity: true,
      }),
    );

    await expect(getTeamProductivity(TEAM_ID)).rejects.toThrow(AuthorizationError);
  });

  it("the team's manager can view even when the toggle is off and they hold no member row", async () => {
    mockRequireUser.mockResolvedValue({ id: MANAGER_ID, globalRole: "USER" });
    db.team.findUnique.mockResolvedValue(
      baseTeam({
        managerId: MANAGER_ID,
        members: [{ userId: MEMBER_ID }],
        membersCanSeeProductivity: false,
      }),
    );

    await expect(getTeamProductivity(TEAM_ID)).resolves.toMatchObject({ teamId: TEAM_ID });
  });

  it("a global Admin can view even when the toggle is off and they aren't a member", async () => {
    mockRequireUser.mockResolvedValue({ id: OTHER_ID, globalRole: "ADMIN" });
    db.team.findUnique.mockResolvedValue(
      baseTeam({
        managerId: MANAGER_ID,
        members: [{ userId: MEMBER_ID }],
        membersCanSeeProductivity: false,
      }),
    );

    await expect(getTeamProductivity(TEAM_ID)).resolves.toMatchObject({ teamId: TEAM_ID });
  });

  it("an inactive team is forbidden even for its own manager (FIX 2)", async () => {
    mockRequireUser.mockResolvedValue({ id: MANAGER_ID, globalRole: "USER" });
    db.team.findUnique.mockResolvedValue(
      baseTeam({ isActive: false, managerId: MANAGER_ID, membersCanSeeProductivity: true }),
    );

    await expect(getTeamProductivity(TEAM_ID)).rejects.toThrow(AuthorizationError);
  });

  it("an inactive team is forbidden even for a global Admin (FIX 2)", async () => {
    mockRequireUser.mockResolvedValue({ id: OTHER_ID, globalRole: "ADMIN" });
    db.team.findUnique.mockResolvedValue(baseTeam({ isActive: false }));

    await expect(getTeamProductivity(TEAM_ID)).rejects.toThrow(AuthorizationError);
  });

  it("a non-existent team is forbidden (not a distinguishable 404)", async () => {
    db.team.findUnique.mockResolvedValue(null);

    await expect(getTeamProductivity(TEAM_ID)).rejects.toThrow(AuthorizationError);
  });
});

describe("getVisibleTeams", () => {
  it("a non-admin's query is scoped to (managed) OR (member AND toggle-on), among active teams", async () => {
    mockRequireUser.mockResolvedValue({ id: ME_ID, globalRole: "USER" });
    db.team.findMany.mockResolvedValue([]);

    await getVisibleTeams();

    expect(db.team.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { managerId: ME_ID },
          { members: { some: { userId: ME_ID } }, membersCanSeeProductivity: true },
        ],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  });

  it("an admin's query returns every active team, with no per-user OR restriction", async () => {
    mockRequireUser.mockResolvedValue({ id: ME_ID, globalRole: "ADMIN" });
    db.team.findMany.mockResolvedValue([]);

    await getVisibleTeams();

    expect(db.team.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  });
});
