// Boundary tests for the "My work" urgency bucketing. Only `dueDate` matters to
// the function, so tasks are minimal stubs cast to BoardTask.

import { describe, expect, it } from "vitest";

import { bucketWorkByDue } from "./work-buckets";
import type { BoardTask } from "@/features/tasks/types";

function task(id: string, dueDate: Date | null): BoardTask {
  return { id, dueDate } as unknown as BoardTask;
}

// Fixed "now": Fri 2026-07-17, 12:00 local → startToday = 2026-07-17T00:00.
const NOW = new Date(2026, 6, 17, 12, 0, 0);

describe("bucketWorkByDue", () => {
  it("places tasks in the correct urgency bucket", () => {
    const tasks = [
      task("overdue", new Date(2026, 6, 16, 23, 59)), // yesterday
      task("today-morning", new Date(2026, 6, 17, 0, 0)), // exactly start of today
      task("today-later", new Date(2026, 6, 17, 23, 59)), // later today
      task("thisWeek", new Date(2026, 6, 20)), // +3 days
      task("weekEdge-in", new Date(2026, 6, 23, 23, 59)), // still < +7d
      task("later-edge", new Date(2026, 6, 24, 0, 0)), // exactly +7d → later
      task("later-far", new Date(2026, 7, 1)), // +2 weeks
      task("nodate", null),
    ];

    const g = bucketWorkByDue(tasks, NOW);

    expect(g.overdue.map((t) => t.id)).toEqual(["overdue"]);
    expect(g.today.map((t) => t.id)).toEqual(["today-morning", "today-later"]);
    expect(g.thisWeek.map((t) => t.id)).toEqual(["thisWeek", "weekEdge-in"]);
    expect(g.later.map((t) => t.id)).toEqual(["later-edge", "later-far"]);
    expect(g.noDate.map((t) => t.id)).toEqual(["nodate"]);
    expect(g.total).toBe(8);
  });

  it("returns all-empty buckets for no tasks", () => {
    const g = bucketWorkByDue([], NOW);
    expect(g.total).toBe(0);
    expect(g.overdue).toEqual([]);
    expect(g.today).toEqual([]);
    expect(g.thisWeek).toEqual([]);
    expect(g.later).toEqual([]);
    expect(g.noDate).toEqual([]);
  });

  it("preserves input order within a bucket", () => {
    const g = bucketWorkByDue(
      [
        task("a", new Date(2026, 6, 17, 8)),
        task("b", new Date(2026, 6, 17, 9)),
        task("c", new Date(2026, 6, 17, 7)),
      ],
      NOW,
    );
    expect(g.today.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});
