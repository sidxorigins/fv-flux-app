import { describe, expect, it } from "vitest";
import { formatMinutes, parseDuration } from "./format";

describe("formatMinutes", () => {
  it("formats hours + minutes", () => expect(formatMinutes(150)).toBe("2h 30m"));
  it("formats whole hours", () => expect(formatMinutes(120)).toBe("2h"));
  it("formats minutes", () => expect(formatMinutes(45)).toBe("45m"));
  it("zero / negative → 0m", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(-5)).toBe("0m");
  });
});

describe("parseDuration", () => {
  it("parses '2h 30m'", () => expect(parseDuration("2h 30m")).toBe(150));
  it("parses '2h'", () => expect(parseDuration("2h")).toBe(120));
  it("parses '45m'", () => expect(parseDuration("45m")).toBe(45));
  it("parses a bare number as minutes", () => expect(parseDuration("90")).toBe(90));
  it("rejects garbage", () => expect(parseDuration("soon")).toBeNull());
  it("rejects zero/empty", () => {
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});
