import { describe, expect, it } from "vitest";
import { groupReactions } from "./reactions";

const rows = [
  { emoji: "👍", userId: "u1", user: { name: "Ann" } },
  { emoji: "👍", userId: "u2", user: { name: "Bob" } },
  { emoji: "🎉", userId: "u2", user: { name: "Bob" } },
];

describe("groupReactions", () => {
  it("groups by emoji with counts + reactor names", () => {
    const g = groupReactions(rows, "u1");
    const thumbs = g.find((r) => r.emoji === "👍");
    expect(thumbs).toEqual({ emoji: "👍", count: 2, reactedByMe: true, users: ["Ann", "Bob"] });
    expect(g.find((r) => r.emoji === "🎉")).toEqual({ emoji: "🎉", count: 1, reactedByMe: false, users: ["Bob"] });
  });
  it("reactedByMe is false when the session user didn't react", () => {
    expect(groupReactions(rows, "u9").every((r) => !r.reactedByMe)).toBe(true);
  });
});
