import { describe, expect, it } from "vitest";
import {
  MIN_POSITION_GAP,
  POSITION_STEP,
  computeMidpoint,
  needsRebalance,
  rebalancedPositions,
} from "./positioning";

describe("computeMidpoint", () => {
  it("returns the midpoint when both neighbours are present", () => {
    expect(computeMidpoint(10, 20)).toBe(15);
    expect(computeMidpoint(0, 100)).toBe(50);
  });

  it("adds a full step past the neighbour when only 'before' is present (bottom of column)", () => {
    expect(computeMidpoint(10, null)).toBe(10 + POSITION_STEP);
    expect(computeMidpoint(0, null)).toBe(POSITION_STEP);
  });

  it("halves the neighbour when only 'after' is present (top of column)", () => {
    expect(computeMidpoint(null, 20)).toBe(10);
    expect(computeMidpoint(null, 0)).toBe(0);
  });

  it("returns POSITION_STEP for an empty column (neither neighbour)", () => {
    expect(computeMidpoint(null, null)).toBe(POSITION_STEP);
  });

  it("handles identical positions by returning that same value (caller must rebalance)", () => {
    expect(computeMidpoint(10, 10)).toBe(10);
  });

  it("is order-agnostic for a negative gap (after < before) — pure average", () => {
    // Board data shouldn't normally be out of order, but the function itself
    // does no ordering assumption: it just averages whatever it's given.
    expect(computeMidpoint(20, 10)).toBe(15);
    expect(computeMidpoint(5, -5)).toBe(0);
  });
});

describe("needsRebalance", () => {
  it("is true when the gap is smaller than MIN_POSITION_GAP", () => {
    expect(needsRebalance(10, 10 + MIN_POSITION_GAP / 2)).toBe(true);
    expect(needsRebalance(10, 10)).toBe(true); // identical positions — zero gap
  });

  it("is false when the gap is exactly at or above MIN_POSITION_GAP (strict <)", () => {
    // Base value 0 keeps the addition exact in IEEE-754 float arithmetic — using a
    // larger base (e.g. 10 + MIN_POSITION_GAP) loses precision and lands the gap
    // just *under* 1e-6, which would make this assertion flaky for the wrong reason.
    expect(needsRebalance(0, MIN_POSITION_GAP)).toBe(false);
    expect(needsRebalance(0, MIN_POSITION_GAP * 2)).toBe(false);
  });

  it("is false whenever a neighbour is missing — open-ended inserts never rebalance", () => {
    expect(needsRebalance(null, 20)).toBe(false);
    expect(needsRebalance(10, null)).toBe(false);
    expect(needsRebalance(null, null)).toBe(false);
  });

  it("uses the absolute gap, so a negative difference is treated the same as positive", () => {
    // before > after (out-of-order data): abs(after - before) still evaluated.
    expect(needsRebalance(20, 10)).toBe(false); // gap magnitude 10, not tiny
    expect(needsRebalance(10 + 1e-7, 10)).toBe(true); // tiny negative diff -> true
  });
});

describe("rebalancedPositions", () => {
  it("returns an empty array for an empty column", () => {
    expect(rebalancedPositions(0)).toEqual([]);
  });

  it("spaces cards evenly starting at POSITION_STEP", () => {
    expect(rebalancedPositions(1)).toEqual([POSITION_STEP]);
    expect(rebalancedPositions(3)).toEqual([
      POSITION_STEP,
      POSITION_STEP * 2,
      POSITION_STEP * 3,
    ]);
  });

  it("produces strictly ascending, evenly-spaced values for a larger column", () => {
    const positions = rebalancedPositions(5);
    expect(positions).toHaveLength(5);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i] - positions[i - 1]).toBe(POSITION_STEP);
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});
