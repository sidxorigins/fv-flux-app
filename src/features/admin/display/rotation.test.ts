import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROTATION_SECONDS,
  MAX_ROTATION_SECONDS,
  MIN_ROTATION_SECONDS,
  clampRotationSeconds,
} from "./rotation";

describe("clampRotationSeconds", () => {
  it("keeps a sensible value unchanged", () => {
    expect(clampRotationSeconds(45)).toBe(45);
  });

  it("clamps to the bounds rather than rejecting", () => {
    expect(clampRotationSeconds(1)).toBe(MIN_ROTATION_SECONDS);
    expect(clampRotationSeconds(9999)).toBe(MAX_ROTATION_SECONDS);
  });

  it("rounds fractional input", () => {
    expect(clampRotationSeconds(20.6)).toBe(21);
  });

  it("falls back to the default for junk — a corrupt row must not freeze the wall", () => {
    expect(clampRotationSeconds(Number.NaN)).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds(Number("not-a-number"))).toBe(DEFAULT_ROTATION_SECONDS);
    expect(clampRotationSeconds(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ROTATION_SECONDS);
  });
});
