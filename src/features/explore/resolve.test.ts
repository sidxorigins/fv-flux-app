// Tests for the Explorer's permission-scope resolution: resolveAccessibleProjectIds
// (membership-or-admin-all) and resolveExploreProjectIds (org-filter intersection).
// Mocking mirrors features/admin/actions.test.ts + features/team/queries.test.ts:
// @/lib/db is a hand-rolled prisma stub (findMany per model, all vi.fn()) and
// @/lib/permissions is stubbed with a mocked requireUser. The big aggregate queries
// (getExploreTasks / getExploreFilterOptions) are intentionally NOT covered here —
// only the scope-resolution logic, per the brief.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/permissions", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const model = () => ({ findMany: vi.fn() });
  const prisma: Record<string, unknown> = {
    project: model(),
    projectMembership: model(),
    teamProject: model(),
  };
  return { prisma };
});

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { resolveAccessibleProjectIds, resolveExploreProjectIds } from "./queries";

interface MockModel {
  findMany: Mock;
}
interface MockPrisma {
  project: MockModel;
  projectMembership: MockModel;
  teamProject: MockModel;
}

const db = prisma as unknown as MockPrisma;
const mockRequireUser = requireUser as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveAccessibleProjectIds", () => {
  it("returns every project id for a global Admin, without querying memberships", async () => {
    mockRequireUser.mockResolvedValue({ id: "admin-1", globalRole: "ADMIN" });
    db.project.findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);

    const result = await resolveAccessibleProjectIds();

    expect(result).toEqual({ ids: ["p1", "p2"], isAdmin: true });
    expect(db.projectMembership.findMany).not.toHaveBeenCalled();
  });

  it("returns only the user's membership project ids for a non-admin", async () => {
    mockRequireUser.mockResolvedValue({ id: "user-1", globalRole: "USER" });
    db.projectMembership.findMany.mockResolvedValue([{ projectId: "p1" }]);

    const result = await resolveAccessibleProjectIds();

    expect(result).toEqual({ ids: ["p1"], isAdmin: false });
    expect(db.project.findMany).not.toHaveBeenCalled();
  });

  it("a non-admin with no memberships gets an empty (not all-projects) result", async () => {
    mockRequireUser.mockResolvedValue({ id: "user-1", globalRole: "USER" });
    db.projectMembership.findMany.mockResolvedValue([]);

    const result = await resolveAccessibleProjectIds();

    expect(result).toEqual({ ids: [], isAdmin: false });
  });
});

describe("resolveExploreProjectIds", () => {
  const ACCESSIBLE = ["p1", "p2", "p3"];

  it("returns the accessible set unchanged when no org filter is given", async () => {
    const result = await resolveExploreProjectIds({}, ACCESSIBLE);
    expect(result.sort()).toEqual([...ACCESSIBLE].sort());
  });

  it("returns [] immediately when the accessible set is already empty, without querying", async () => {
    const result = await resolveExploreProjectIds({ teamId: "t1" }, []);

    expect(result).toEqual([]);
    expect(db.teamProject.findMany).not.toHaveBeenCalled();
  });

  it("intersects with a single projectId filter (no DB call needed)", async () => {
    const result = await resolveExploreProjectIds({ projectId: "p2" }, ACCESSIBLE);

    expect(result).toEqual(["p2"]);
    expect(db.teamProject.findMany).not.toHaveBeenCalled();
    expect(db.project.findMany).not.toHaveBeenCalled();
  });

  it("a projectId outside the accessible set resolves to []", async () => {
    const result = await resolveExploreProjectIds({ projectId: "other" }, ACCESSIBLE);
    expect(result).toEqual([]);
  });

  it("intersects with a team's projects (teamId)", async () => {
    db.teamProject.findMany.mockResolvedValue([{ projectId: "p1" }, { projectId: "p9" }]);

    const result = await resolveExploreProjectIds({ teamId: "team-1" }, ACCESSIBLE);

    expect(db.teamProject.findMany).toHaveBeenCalledWith({
      where: { teamId: "team-1" },
      select: { projectId: true },
    });
    expect(result).toEqual(["p1"]);
  });

  it("a team outside the accessible set resolves to []", async () => {
    db.teamProject.findMany.mockResolvedValue([{ projectId: "p9" }, { projectId: "p10" }]);

    const result = await resolveExploreProjectIds({ teamId: "team-1" }, ACCESSIBLE);

    expect(result).toEqual([]);
  });

  it("intersects with the projects of teams a manager manages (managerId)", async () => {
    db.teamProject.findMany.mockResolvedValue([{ projectId: "p3" }]);

    const result = await resolveExploreProjectIds({ managerId: "mgr-1" }, ACCESSIBLE);

    expect(db.teamProject.findMany).toHaveBeenCalledWith({
      where: { team: { managerId: "mgr-1" } },
      select: { projectId: true },
    });
    expect(result).toEqual(["p3"]);
  });

  it("a manager outside the accessible set resolves to []", async () => {
    db.teamProject.findMany.mockResolvedValue([]);

    const result = await resolveExploreProjectIds({ managerId: "mgr-x" }, ACCESSIBLE);

    expect(result).toEqual([]);
  });

  it("intersects with projects led (primary or additional) by leadId", async () => {
    db.project.findMany.mockResolvedValue([{ id: "p1" }]);

    const result = await resolveExploreProjectIds({ leadId: "lead-1" }, ACCESSIBLE);

    expect(db.project.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ leadId: "lead-1" }, { additionalLeads: { some: { userId: "lead-1" } } }],
      },
      select: { id: true },
    });
    expect(result).toEqual(["p1"]);
  });

  it("a lead outside the accessible set resolves to []", async () => {
    db.project.findMany.mockResolvedValue([{ id: "p9" }]);

    const result = await resolveExploreProjectIds({ leadId: "lead-x" }, ACCESSIBLE);

    expect(result).toEqual([]);
  });

  it("combines multiple org filters as an AND intersection", async () => {
    db.teamProject.findMany
      .mockResolvedValueOnce([{ projectId: "p1" }, { projectId: "p2" }]) // teamId
      .mockResolvedValueOnce([{ projectId: "p2" }, { projectId: "p3" }]); // managerId

    const result = await resolveExploreProjectIds(
      { teamId: "team-1", managerId: "mgr-1" },
      ACCESSIBLE,
    );

    expect(result).toEqual(["p2"]);
  });

  it("short-circuits once the running set is empty, skipping later org-filter queries", async () => {
    db.teamProject.findMany.mockResolvedValueOnce([]); // teamId narrows straight to []

    const result = await resolveExploreProjectIds(
      { teamId: "team-1", leadId: "lead-1" },
      ACCESSIBLE,
    );

    expect(result).toEqual([]);
    expect(db.project.findMany).not.toHaveBeenCalled(); // leadId query never runs
  });
});
