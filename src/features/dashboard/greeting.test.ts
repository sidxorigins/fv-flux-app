import { describe, expect, it } from "vitest";

import { dubaiDateLine, greetingFor } from "./greeting";

// Dubai is UTC+4 year-round. 2026-07-23T04:00Z = 08:00 in Dubai.
describe("greetingFor", () => {
  it("08:00 Dubai → morning", () => {
    expect(greetingFor(new Date("2026-07-23T04:00:00Z"))).toBe("morning");
  });
  it("13:00 Dubai → afternoon", () => {
    expect(greetingFor(new Date("2026-07-23T09:00:00Z"))).toBe("afternoon");
  });
  it("19:00 Dubai → evening", () => {
    expect(greetingFor(new Date("2026-07-23T15:00:00Z"))).toBe("evening");
  });
  it("03:00 Dubai (23:00Z prev day) → evening", () => {
    expect(greetingFor(new Date("2026-07-22T23:00:00Z"))).toBe("evening");
  });
  it("boundary 12:00 Dubai → afternoon", () => {
    expect(greetingFor(new Date("2026-07-23T08:00:00Z"))).toBe("afternoon");
  });
});

describe("dubaiDateLine", () => {
  it("formats weekday + day + month in Dubai time", () => {
    // 23:00Z on 22 Jul = 03:00 on 23 Jul in Dubai — date must be the 23rd.
    expect(dubaiDateLine(new Date("2026-07-22T23:00:00Z"))).toBe(
      "Thursday, 23 July",
    );
  });
});
