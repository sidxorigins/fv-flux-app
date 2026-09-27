import { describe, expect, it } from "vitest";
import {
  eachIsoDate,
  formatDateRange,
  formatDayLong,
  formatSessionTime,
  fromIsoDate,
  pickDefaultDay,
  todayInZone,
  toIsoDate,
} from "./dates";

describe("event date helpers", () => {
  it("round-trips ISO dates through UTC midnight", () => {
    expect(toIsoDate(fromIsoDate("2026-11-20"))).toBe("2026-11-20");
  });

  it("enumerates every date in a range inclusively", () => {
    expect(eachIsoDate("2026-11-20", "2026-11-26")).toHaveLength(7);
    expect(eachIsoDate("2026-11-30", "2026-12-02")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(eachIsoDate("2026-11-20", "2026-11-20")).toEqual(["2026-11-20"]);
  });

  it("computes today in the event's zone, not the server's", () => {
    // 22:30 UTC on the 20th is already the 21st in Dubai (+4) but still the 20th in Luxembourg (+1).
    const now = new Date("2026-11-20T22:30:00Z");
    expect(todayInZone("Asia/Dubai", now)).toBe("2026-11-21");
    expect(todayInZone("Europe/Luxembourg", now)).toBe("2026-11-20");
    expect(todayInZone("Not/AZone", now)).toBe("2026-11-20");
  });

  it("picks today, else the next upcoming day, else the last day", () => {
    const days = ["2026-11-20", "2026-11-21", "2026-11-22"].map((d) => ({ date: fromIsoDate(d) }));
    expect(toIsoDate(pickDefaultDay(days, "2026-11-21")!.date)).toBe("2026-11-21");
    expect(toIsoDate(pickDefaultDay(days, "2026-10-01")!.date)).toBe("2026-11-20");
    expect(toIsoDate(pickDefaultDay(days, "2026-12-01")!.date)).toBe("2026-11-22");
    expect(pickDefaultDay([], "2026-12-01")).toBeNull();
  });

  it("formats labels", () => {
    expect(formatDayLong(fromIsoDate("2026-11-20"))).toBe("Friday 20 November");
    expect(formatDateRange(fromIsoDate("2026-11-20"), fromIsoDate("2026-11-26"))).toBe("20–26 Nov 2026");
    expect(formatDateRange(fromIsoDate("2026-11-28"), fromIsoDate("2026-12-02"))).toBe("28 Nov – 2 Dec 2026");
    expect(formatSessionTime({ startTime: "10:30", endTime: "14:00", timeLabel: null })).toBe("10:30–14:00");
    expect(formatSessionTime({ startTime: "10:30", endTime: null, timeLabel: null })).toBe("10:30");
    expect(formatSessionTime({ startTime: null, endTime: null, timeLabel: "Morning" })).toBe("Morning");
    expect(formatSessionTime({ startTime: null, endTime: null, timeLabel: null })).toBe("—");
  });
});
