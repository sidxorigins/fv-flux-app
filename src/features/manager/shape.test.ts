// Boundary tests for the pure manager-dashboard shaping helpers. These are the
// only manager/ helpers unit-tested — the DB queries in queries.ts follow the
// proven, untested pattern from features/dashboard/queries.ts.

import { describe, expect, it } from "vitest";

import { bucketCompletion, isOverEstimate, remainingHours } from "./shape";

describe("bucketCompletion", () => {
  it("returns on_time when completed at or before the due date", () => {
    const due = new Date(2026, 6, 17);
    const completed = new Date(2026, 6, 16);
    expect(bucketCompletion(due, completed)).toBe("on_time");
  });

  it("returns on_time when completed exactly at the due date", () => {
    const due = new Date(2026, 6, 17, 12, 0);
    const completed = new Date(2026, 6, 17, 12, 0);
    expect(bucketCompletion(due, completed)).toBe("on_time");
  });

  it("returns late when completed after the due date", () => {
    const due = new Date(2026, 6, 17);
    const completed = new Date(2026, 6, 18);
    expect(bucketCompletion(due, completed)).toBe("late");
  });

  it("returns no_due when dueDate is null", () => {
    expect(bucketCompletion(null, new Date(2026, 6, 18))).toBe("no_due");
  });

  it("returns no_due when completedAt is null", () => {
    expect(bucketCompletion(new Date(2026, 6, 17), null)).toBe("no_due");
  });

  it("returns no_due when both are null", () => {
    expect(bucketCompletion(null, null)).toBe("no_due");
  });
});

describe("remainingHours", () => {
  it("returns estimated minus actual when positive", () => {
    expect(remainingHours(10, 4)).toBe(6);
  });

  it("floors at 0 when actual exceeds estimated", () => {
    expect(remainingHours(5, 8)).toBe(0);
  });

  it("returns 0 when estimated is null", () => {
    expect(remainingHours(null, 4)).toBe(0);
  });

  it("returns 0 when estimated equals actual", () => {
    expect(remainingHours(5, 5)).toBe(0);
  });
});

describe("isOverEstimate", () => {
  it("returns true when actual exceeds estimated (both present)", () => {
    expect(isOverEstimate(5, 8)).toBe(true);
  });

  it("returns false when actual is less than estimated", () => {
    expect(isOverEstimate(8, 5)).toBe(false);
  });

  it("returns false when actual equals estimated", () => {
    expect(isOverEstimate(5, 5)).toBe(false);
  });

  it("returns false when estimated is null", () => {
    expect(isOverEstimate(null, 100)).toBe(false);
  });
});
