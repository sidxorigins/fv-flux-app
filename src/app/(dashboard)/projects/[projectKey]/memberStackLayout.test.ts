import { describe, expect, it } from "vitest";

import {
  AVATAR,
  COLLAPSED_STEP,
  EXPANDED_STEP,
  chipOffset,
  collapsedWidth,
  expandedWidth,
} from "./memberStackLayout";

describe("member stack geometry", () => {
  it("overlaps the faces when collapsed", () => {
    // Step smaller than the avatar is what produces the overlap the expand
    // gesture exists to undo.
    expect(COLLAPSED_STEP).toBeLessThan(AVATAR);
  });

  it("separates the faces when expanded", () => {
    expect(EXPANDED_STEP).toBeGreaterThan(AVATAR);
  });

  it("measures a single chip as one avatar wide in both states", () => {
    expect(collapsedWidth(1)).toBe(AVATAR);
    expect(expandedWidth(1)).toBe(AVATAR);
  });

  it("is empty at zero chips rather than negative", () => {
    expect(collapsedWidth(0)).toBe(0);
    expect(expandedWidth(0)).toBe(0);
  });

  it("always needs at least as much room expanded as collapsed", () => {
    for (let n = 1; n <= 6; n++) {
      expect(expandedWidth(n)).toBeGreaterThanOrEqual(collapsedWidth(n));
    }
  });

  it("lays collapsed chips out left-to-right from zero", () => {
    expect(chipOffset(0, false, 5)).toBe(0);
    expect(chipOffset(1, false, 5)).toBe(COLLAPSED_STEP);
    expect(chipOffset(4, false, 5)).toBe(4 * COLLAPSED_STEP);
  });

  it("pins the right edge when expanding", () => {
    // The regression this guards: if the shift were dropped, the row would
    // grow rightward and shove the header controls sideways on every click.
    const chips = 5;
    const lastCollapsed = chipOffset(chips - 1, false, chips);
    const lastExpanded = chipOffset(chips - 1, true, chips);
    expect(lastExpanded).toBe(lastCollapsed);
  });

  it("grows leftward, so early chips move to negative offsets", () => {
    expect(chipOffset(0, true, 5)).toBeLessThan(0);
    expect(chipOffset(0, true, 5)).toBe(
      -(expandedWidth(5) - collapsedWidth(5)),
    );
  });

  it("keeps chips in order and clear of each other when expanded", () => {
    const chips = 6;
    for (let i = 1; i < chips; i++) {
      const gap = chipOffset(i, true, chips) - chipOffset(i - 1, true, chips);
      expect(gap).toBe(EXPANDED_STEP);
      expect(gap).toBeGreaterThan(AVATAR);
    }
  });

  it("does not move at all when there is only one chip", () => {
    expect(chipOffset(0, false, 1)).toBe(0);
    expect(chipOffset(0, true, 1)).toBe(0);
  });
});
