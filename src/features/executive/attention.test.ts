import { describe, expect, it } from "vitest";

import { rankAttention, type AttentionItem, type AttentionKind } from "./attention";

function item(kind: AttentionKind, ageDays: number, id: string): AttentionItem {
  return {
    id,
    taskKey: `OPS-${id}`,
    projectId: "p1",
    projectKey: "OPS",
    title: `Task ${id}`,
    kind,
    ageDays,
    assigneeName: null,
    canOpen: true,
  };
}

function many(kind: AttentionKind, n: number, prefix: string): AttentionItem[] {
  return Array.from({ length: n }, (_, i) => item(kind, n - i, `${prefix}${i}`));
}

const countBy = (items: AttentionItem[], kind: AttentionKind): number =>
  items.filter((i) => i.kind === kind).length;

describe("rankAttention", () => {
  it("returns everything when the total fits under the cap", () => {
    const result = rankAttention(
      [...many("OVERDUE", 2, "o"), ...many("STUCK_IN_REVIEW", 1, "s")],
      15,
    );
    expect(result).toHaveLength(3);
  });

  it("never lets one kind crowd the others out entirely", () => {
    // The defect this function exists to prevent: 20 overdue would otherwise
    // fill all 15 slots and hide 8 real problems completely.
    const result = rankAttention(
      [
        ...many("OVERDUE", 20, "o"),
        ...many("STUCK_IN_REVIEW", 5, "s"),
        ...many("UNOWNED_URGENT", 3, "u"),
      ],
      15,
    );
    expect(result).toHaveLength(15);
    expect(countBy(result, "STUCK_IN_REVIEW")).toBeGreaterThan(0);
    expect(countBy(result, "UNOWNED_URGENT")).toBeGreaterThan(0);
    expect(countBy(result, "OVERDUE")).toBeGreaterThan(0);
  });

  it("gives leftover slots to the higher-precedence kinds", () => {
    const result = rankAttention(
      [
        ...many("OVERDUE", 20, "o"),
        ...many("STUCK_IN_REVIEW", 5, "s"),
        ...many("UNOWNED_URGENT", 3, "u"),
      ],
      15,
    );
    // Each kind reserves up to 3, then OVERDUE takes the remaining 6.
    expect(countBy(result, "OVERDUE")).toBe(9);
    expect(countBy(result, "STUCK_IN_REVIEW")).toBe(3);
    expect(countBy(result, "UNOWNED_URGENT")).toBe(3);
  });

  it("does not reserve slots for a kind with no items", () => {
    const result = rankAttention(many("OVERDUE", 20, "o"), 15);
    expect(result).toHaveLength(15);
    expect(countBy(result, "OVERDUE")).toBe(15);
  });

  it("orders the result by kind precedence, then by age descending", () => {
    const result = rankAttention(
      [item("STUCK_IN_REVIEW", 9, "s1"), item("OVERDUE", 1, "o1"), item("OVERDUE", 7, "o2")],
      15,
    );
    expect(result.map((i) => i.id)).toEqual(["o2", "o1", "s1"]);
  });

  it("drops duplicates by id, keeping the highest-precedence kind", () => {
    const result = rankAttention(
      [item("OVERDUE", 3, "dup"), item("UNOWNED_URGENT", 3, "dup")],
      15,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe("OVERDUE");
  });

  it("returns an empty list for no candidates", () => {
    expect(rankAttention([], 15)).toEqual([]);
  });
});
