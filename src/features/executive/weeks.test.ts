import { describe, expect, it } from "vitest";

import { WEEK_MS, splitCompletionsByWeek, startOfIsoWeek, weekLabel } from "./weeks";

describe("startOfIsoWeek", () => {
  it("returns Monday midnight for a mid-week date", () => {
    // Wednesday 2026-07-22, 14:30 local
    const result = startOfIsoWeek(new Date(2026, 6, 22, 14, 30));
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(6);
    expect(result.getDate()).toBe(20); // Monday
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
  });

  it("treats Monday itself as the start of its own week", () => {
    const result = startOfIsoWeek(new Date(2026, 6, 20, 9, 0));
    expect(result.getDate()).toBe(20);
    expect(result.getHours()).toBe(0);
  });

  it("treats Sunday as the END of the week that began the previous Monday", () => {
    const result = startOfIsoWeek(new Date(2026, 6, 26, 23, 59));
    expect(result.getDate()).toBe(20);
  });

  it("does not mutate its argument", () => {
    const input = new Date(2026, 6, 22, 14, 30);
    startOfIsoWeek(input);
    expect(input.getDate()).toBe(22);
    expect(input.getHours()).toBe(14);
  });
});

describe("weekLabel", () => {
  it("formats a week-start as day + short month", () => {
    expect(weekLabel(new Date(2026, 6, 20))).toBe("20 Jul");
  });
});

describe("WEEK_MS", () => {
  it("is seven days of milliseconds", () => {
    expect(WEEK_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("splitCompletionsByWeek", () => {
  const thisWeekStart = new Date(2026, 6, 20); // Monday 2026-07-20, 00:00

  it("assigns a completion at exactly the week boundary to THIS week", () => {
    const { thisWeek, lastWeek } = splitCompletionsByWeek(
      [{ taskId: "t1", createdAt: new Date(2026, 6, 20, 0, 0, 0, 0) }],
      thisWeekStart,
    );
    expect(thisWeek.size).toBe(1);
    expect(lastWeek.size).toBe(0);
  });

  it("assigns a completion one millisecond before the boundary to LAST week", () => {
    const { thisWeek, lastWeek } = splitCompletionsByWeek(
      [{ taskId: "t1", createdAt: new Date(2026, 6, 19, 23, 59, 59, 999) }],
      thisWeekStart,
    );
    expect(thisWeek.size).toBe(0);
    expect(lastWeek.size).toBe(1);
  });

  it("counts a task bounced through Done twice in one week only once", () => {
    const { thisWeek } = splitCompletionsByWeek(
      [
        { taskId: "t1", createdAt: new Date(2026, 6, 21, 9, 0) },
        { taskId: "t1", createdAt: new Date(2026, 6, 23, 15, 0) },
      ],
      thisWeekStart,
    );
    expect(thisWeek.size).toBe(1);
  });

  it("counts the same task in BOTH weeks when completed in each", () => {
    const { thisWeek, lastWeek } = splitCompletionsByWeek(
      [
        { taskId: "t1", createdAt: new Date(2026, 6, 15, 9, 0) },
        { taskId: "t1", createdAt: new Date(2026, 6, 21, 9, 0) },
      ],
      thisWeekStart,
    );
    expect(thisWeek.size).toBe(1);
    expect(lastWeek.size).toBe(1);
  });
});
