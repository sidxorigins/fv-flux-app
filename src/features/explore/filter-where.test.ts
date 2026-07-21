// Pure tests for exploreTaskWhere — no mocks, no DB. Each filter is asserted in
// isolation, then a combined case checks nothing clobbers anything else.

import { describe, expect, it } from "vitest";

import { exploreTaskWhere } from "./filter-where";
import type { ExploreFilters } from "./schemas";

const PROJECT_IDS = ["proj-1", "proj-2"];
const NOW = new Date("2026-07-21T12:00:00Z");

describe("exploreTaskWhere", () => {
  it("always scopes to the given project ids", () => {
    const where = exploreTaskWhere({}, PROJECT_IDS, NOW);
    expect(where.projectId).toEqual({ in: PROJECT_IDS });
  });

  it("produces no extra clauses when no filters are set", () => {
    const where = exploreTaskWhere({}, PROJECT_IDS, NOW);
    expect(where).toEqual({ projectId: { in: PROJECT_IDS } });
  });

  it("filters to unassigned tasks when unassigned is set", () => {
    const filters: ExploreFilters = { unassigned: true };
    expect(exploreTaskWhere(filters, PROJECT_IDS, NOW).assigneeId).toBeNull();
  });

  it("filters to a specific assignee", () => {
    const filters: ExploreFilters = { assigneeId: "user-1" };
    expect(exploreTaskWhere(filters, PROJECT_IDS, NOW).assigneeId).toEqual({
      in: ["user-1"],
    });
  });

  it("unassigned wins over assigneeId if both are somehow set", () => {
    const filters: ExploreFilters = { unassigned: true, assigneeId: "user-1" };
    expect(exploreTaskWhere(filters, PROJECT_IDS, NOW).assigneeId).toBeNull();
  });

  it("filters by type equality", () => {
    expect(exploreTaskWhere({ type: "BUG" }, PROJECT_IDS, NOW).type).toBe("BUG");
  });

  it("filters by status equality", () => {
    expect(exploreTaskWhere({ status: "IN_REVIEW" }, PROJECT_IDS, NOW).status).toBe(
      "IN_REVIEW",
    );
  });

  it("filters by priority equality", () => {
    expect(exploreTaskWhere({ priority: "URGENT" }, PROJECT_IDS, NOW).priority).toBe(
      "URGENT",
    );
  });

  it("filters by label membership", () => {
    const where = exploreTaskWhere({ labelId: "label-1" }, PROJECT_IDS, NOW);
    expect(where.labels).toEqual({ some: { id: "label-1" } });
  });

  it("builds a dueDate range from dueFrom/dueTo", () => {
    const dueFrom = new Date("2026-07-01");
    const dueTo = new Date("2026-07-31");
    const where = exploreTaskWhere({ dueFrom, dueTo }, PROJECT_IDS, NOW);
    expect(where.dueDate).toEqual({ gte: dueFrom, lte: dueTo });
  });

  it("builds a one-sided dueDate range from dueFrom alone", () => {
    const dueFrom = new Date("2026-07-01");
    const where = exploreTaskWhere({ dueFrom }, PROJECT_IDS, NOW);
    expect(where.dueDate).toEqual({ gte: dueFrom });
  });

  it("builds a createdAt range from createdFrom/createdTo", () => {
    const createdFrom = new Date("2026-01-01");
    const createdTo = new Date("2026-06-30");
    const where = exploreTaskWhere({ createdFrom, createdTo }, PROJECT_IDS, NOW);
    expect(where.createdAt).toEqual({ gte: createdFrom, lte: createdTo });
  });

  it("overdue excludes DONE tasks and caps dueDate before now", () => {
    const where = exploreTaskWhere({ overdue: true }, PROJECT_IDS, NOW);
    expect(where.status).toEqual({ not: "DONE" });
    expect(where.dueDate).toEqual({ lt: NOW });
  });

  it("an explicit status filter stays authoritative over overdue's not-DONE clause", () => {
    const where = exploreTaskWhere({ overdue: true, status: "IN_REVIEW" }, PROJECT_IDS, NOW);
    expect(where.status).toBe("IN_REVIEW");
    // overdue's dueDate clause still applies even though status was overridden.
    expect(where.dueDate).toEqual({ lt: NOW });
  });

  it("overdue merges into an explicit dueTo instead of clobbering it", () => {
    const dueTo = new Date("2026-08-01");
    const where = exploreTaskWhere({ overdue: true, dueTo }, PROJECT_IDS, NOW);
    expect(where.dueDate).toEqual({ lte: dueTo, lt: NOW });
  });

  it("noEstimate filters to tasks with no estimatedHours", () => {
    expect(exploreTaskWhere({ noEstimate: true }, PROJECT_IDS, NOW).estimatedHours).toBeNull();
  });

  it("combines every filter together without clobbering", () => {
    const dueFrom = new Date("2026-07-01");
    const createdFrom = new Date("2026-01-01");
    const filters: ExploreFilters = {
      assigneeId: "user-1",
      type: "BUG",
      status: "IN_PROGRESS",
      priority: "HIGH",
      labelId: "label-1",
      dueFrom,
      createdFrom,
      noEstimate: true,
    };

    expect(exploreTaskWhere(filters, PROJECT_IDS, NOW)).toEqual({
      projectId: { in: PROJECT_IDS },
      assigneeId: { in: ["user-1"] },
      type: "BUG",
      status: "IN_PROGRESS",
      priority: "HIGH",
      labels: { some: { id: "label-1" } },
      dueDate: { gte: dueFrom },
      createdAt: { gte: createdFrom },
      estimatedHours: null,
    });
  });
});
