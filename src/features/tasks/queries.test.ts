// Pure unit test of taskFilterWhere — no DB/permission behaviour is exercised.
// queries.ts unconditionally imports @/lib/db and @/lib/permissions at module
// scope; @/lib/permissions transitively pulls in next-auth (via @/lib/auth),
// which breaks module resolution under Vitest. Stub both with the same minimal
// shape used by ./actions.test.ts so the module can load — nothing here asserts
// on the stubs, they exist only to satisfy the import chain.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/permissions", () => ({
  canViewProject: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { task: {}, project: {}, label: {} },
}));

import { taskFilterWhere } from "./queries";

describe("taskFilterWhere — assignee", () => {
  it("filters by a set of assignee ids (IN)", () => {
    const w = taskFilterWhere("p1", { assigneeIds: ["u1", "u2"] });
    expect(w.assigneeId).toEqual({ in: ["u1", "u2"] });
    expect(w.AND).toBeUndefined();
  });

  it("filters unassigned as assigneeId null", () => {
    const w = taskFilterWhere("p1", { includeUnassigned: true });
    expect(w.assigneeId).toBeNull();
  });

  it("ORs ids + unassigned together under AND", () => {
    const w = taskFilterWhere("p1", {
      assigneeIds: ["u1"],
      includeUnassigned: true,
    });
    expect(w.assigneeId).toBeUndefined();
    expect(w.AND).toEqual([
      { OR: [{ assigneeId: null }, { assigneeId: { in: ["u1"] } }] },
    ]);
  });

  it("AND-composes the assignee OR-group with the search OR-group", () => {
    const w = taskFilterWhere("p1", {
      assigneeIds: ["u1"],
      includeUnassigned: true,
      q: "login",
    });
    // Two independent OR groups both apply — neither is dropped.
    expect(w.AND).toHaveLength(2);
  });

  it("no assignee filter → no assignee constraint", () => {
    const w = taskFilterWhere("p1", {});
    expect(w.assigneeId).toBeUndefined();
    expect(w.AND).toBeUndefined();
  });
});
