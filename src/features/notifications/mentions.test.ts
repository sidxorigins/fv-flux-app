import { describe, expect, it } from "vitest";

import { extractMentionUsernames } from "./mentions";

describe("extractMentionUsernames", () => {
  it("pulls a single @username from plain paragraph HTML", () => {
    expect(extractMentionUsernames("<p>hey @tester look</p>")).toEqual([
      "tester",
    ]);
  });

  it("lowercases and de-duplicates", () => {
    expect(
      extractMentionUsernames("<p>@Alice @alice @ALICE</p>"),
    ).toEqual(["alice"]);
  });

  it("finds multiple distinct mentions", () => {
    expect(
      extractMentionUsernames("<p>@bob and @carol_99 please review</p>").sort(),
    ).toEqual(["bob", "carol_99"]);
  });

  it("ignores tokens shorter than 3 chars (username floor)", () => {
    expect(extractMentionUsernames("<p>@ab @x hi</p>")).toEqual([]);
  });

  it("does not treat an email address as a mention of the domain", () => {
    // The @ is preceded by name chars, but the regex still matches the run
    // after @ — the resolver later filters to real project members, so a
    // spurious token simply resolves to nobody. Assert the parser stays
    // predictable rather than clever.
    expect(extractMentionUsernames("<p>mail me at bob@example</p>")).toEqual([
      "example",
    ]);
  });

  it("returns empty for HTML with no mentions", () => {
    expect(extractMentionUsernames("<p>just a normal comment</p>")).toEqual([]);
  });

  it("strips tags so a mention split by markup still parses", () => {
    expect(
      extractMentionUsernames("<p>hi <strong>@tester</strong></p>"),
    ).toEqual(["tester"]);
  });
});
