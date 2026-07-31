import { describe, expect, it } from "vitest";

import { isAssigneeSelected, toggleAssigneeValue } from "./assigneeFilter";

const ME = "user-me";
const OTHER = "user-other";

describe("isAssigneeSelected", () => {
  it("is false for an empty filter", () => {
    expect(isAssigneeSelected([], OTHER, ME)).toBe(false);
  });

  it("matches a plain user id", () => {
    expect(isAssigneeSelected([OTHER], OTHER, ME)).toBe(true);
  });

  it("treats the `me` alias as the signed-in user", () => {
    expect(isAssigneeSelected(["me"], ME, ME)).toBe(true);
  });

  it("does not let `me` select anybody else", () => {
    expect(isAssigneeSelected(["me"], OTHER, ME)).toBe(false);
  });
});

describe("toggleAssigneeValue", () => {
  it("adds a member to an empty filter", () => {
    expect(toggleAssigneeValue([], OTHER, ME)).toEqual([OTHER]);
  });

  it("removes a member already filtered on", () => {
    expect(toggleAssigneeValue([OTHER], OTHER, ME)).toEqual([]);
  });

  it("keeps other members when toggling one off", () => {
    expect(toggleAssigneeValue([OTHER, ME], OTHER, ME)).toEqual([ME]);
  });

  it("preserves the `none` (unassigned) value", () => {
    expect(toggleAssigneeValue(["none"], OTHER, ME)).toEqual(["none", OTHER]);
    expect(toggleAssigneeValue(["none", OTHER], OTHER, ME)).toEqual(["none"]);
  });

  it("clears the `me` alias when de-selecting the signed-in user", () => {
    // The regression this guards: filtering by `me` via TaskFilters and then
    // clicking your own avatar off in the stack must actually clear it.
    expect(toggleAssigneeValue(["me"], ME, ME)).toEqual([]);
  });

  it("clears both spellings when the URL carries id and alias together", () => {
    expect(toggleAssigneeValue(["me", ME, OTHER], ME, ME)).toEqual([OTHER]);
  });

  it("leaves `me` alone when toggling a different member off", () => {
    expect(toggleAssigneeValue(["me", OTHER], OTHER, ME)).toEqual(["me"]);
  });

  it("does not mutate the input", () => {
    const values = [OTHER];
    toggleAssigneeValue(values, OTHER, ME);
    expect(values).toEqual([OTHER]);
  });
});
