// Boundary tests for the pure team-productivity shaping helper. This is the
// only team/ helper unit-tested — the DB queries in queries.ts follow the
// proven, untested pattern from features/manager/queries.ts.

import { describe, expect, it } from "vitest";

import { completionPct } from "./shape";

describe("completionPct", () => {
  it("returns 0 when total is 0", () => {
    expect(completionPct(0, 0)).toBe(0);
  });

  it("returns 0 when total is negative", () => {
    expect(completionPct(0, -1)).toBe(0);
  });

  it("rounds to the nearest integer percentage", () => {
    expect(completionPct(3, 4)).toBe(75);
  });

  it("rounds 1/3 down to 33", () => {
    expect(completionPct(1, 3)).toBe(33);
  });

  it("returns 100 when done equals total", () => {
    expect(completionPct(4, 4)).toBe(100);
  });
});
