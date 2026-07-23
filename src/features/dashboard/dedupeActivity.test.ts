import { describe, expect, it } from "vitest";

import { dedupeActivity } from "./dedupe-activity";
import type { DashboardActivity } from "./queries";

function item(over: Partial<DashboardActivity> & { id: string }): DashboardActivity {
  return {
    action: "updated",
    field: "title",
    oldValue: null,
    newValue: null,
    createdAt: new Date("2026-07-20T10:00:00Z"),
    actor: { id: "u1", name: "Flux Admin", avatarUrl: null },
    task: { id: "t1", key: "FLUX-5", title: "Task", projectId: "p1", projectKey: "FLUX" },
    ...over,
  };
}

describe("dedupeActivity", () => {
  it("collapses consecutive same actor+action+field+task into one row with count", () => {
    const input = [
      item({ id: "a" }),
      item({ id: "b" }),
      item({ id: "c" }),
    ];
    const out = dedupeActivity(input);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a"); // keeps the first (most recent) row
    expect(out[0].count).toBe(3);
  });

  it("does not collapse across a different task or action", () => {
    const input = [
      item({ id: "a" }),
      item({ id: "b", task: { id: "t2", key: "FLUX-7", title: "Other", projectId: "p1", projectKey: "FLUX" } }),
      item({ id: "c" }),
    ];
    const out = dedupeActivity(input);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(out.every((i) => i.count === 1)).toBe(true);
  });

  it("does not collapse across different actors and preserves order", () => {
    const input = [
      item({ id: "a" }),
      item({ id: "b", actor: { id: "u2", name: "Sam", avatarUrl: null } }),
    ];
    const out = dedupeActivity(input);
    expect(out.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns [] for []", () => {
    expect(dedupeActivity([])).toEqual([]);
  });
});
