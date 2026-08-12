import { describe, expect, it } from "vitest";

import {
  DAILY_ACTIVES_MAP,
  formatCount,
  formatExact,
  formatDuration,
  ga4DateToUtc,
  deltaPct,
  parseDailyReport,
  platformToScope,
  stickiness,
  truncateToMinute,
} from "./metrics";

describe("ga4DateToUtc", () => {
  it("parses YYYYMMDD to UTC midnight", () => {
    expect(ga4DateToUtc("20260810")?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("rejects malformed input rather than producing Invalid Date", () => {
    for (const bad of ["", "2026-08-10", "202608", "abcdefgh", "20261301"]) {
      expect(ga4DateToUtc(bad)).toBeNull();
    }
  });

  it("rejects a real-looking date that would roll forward", () => {
    // Date.UTC(2026, 1, 31) silently becomes 3 March — must not be accepted.
    expect(ga4DateToUtc("20260231")).toBeNull();
  });
});

describe("platformToScope", () => {
  it("keeps iOS and Android separate rather than collapsing to 'app'", () => {
    expect(platformToScope("web")).toBe("web");
    expect(platformToScope("android")).toBe("android");
    expect(platformToScope("ios")).toBe("ios");
  });

  it("handles GA4's capitalised platform values", () => {
    // The live API returns "Android" / "iOS", not lowercase.
    expect(platformToScope("Android")).toBe("android");
    expect(platformToScope("iOS")).toBe("ios");
  });

  it("falls back to 'other' for anything unrecognised", () => {
    expect(platformToScope("smart tv")).toBe("other");
    expect(platformToScope("")).toBe("other");
  });
});

describe("truncateToMinute", () => {
  it("zeroes seconds and milliseconds", () => {
    expect(truncateToMinute(new Date("2026-08-10T13:37:42.851Z")).toISOString()).toBe(
      "2026-08-10T13:37:00.000Z",
    );
  });
});

describe("stickiness", () => {
  it("returns DAU/MAU as a percentage to one decimal", () => {
    expect(stickiness(25, 814)).toBe(3.1);
  });

  it("returns null when MAU is zero rather than a misleading 0%", () => {
    expect(stickiness(0, 0)).toBeNull();
  });
});

describe("deltaPct", () => {
  it("computes percentage change", () => {
    expect(deltaPct(110, 100)).toBe(10);
    expect(deltaPct(90, 100)).toBe(-10);
  });

  it("returns null with no baseline — growth from zero is undefined", () => {
    expect(deltaPct(50, 0)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("shows bare seconds under a minute", () => {
    expect(formatDuration(58)).toBe("58s");
  });

  it("zero-pads the seconds part", () => {
    expect(formatDuration(364)).toBe("6m 04s");
  });

  it("clamps negatives to zero", () => {
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("formatCount", () => {
  it("leaves small numbers alone", () => {
    expect(formatCount(814)).toBe("814");
  });

  it("abbreviates thousands and millions", () => {
    expect(formatCount(1250)).toBe("1.3k");
    expect(formatCount(27768)).toBe("28k");
    expect(formatCount(2_400_000)).toBe("2.4M");
  });
});

describe("parseDailyReport", () => {
  const report = {
    dimensionHeaders: [{ name: "date" }, { name: "platform" }],
    metricHeaders: [{ name: "active1DayUsers" }, { name: "active28DayUsers" }],
    rows: [
      {
        dimensionValues: [{ value: "20260809" }, { value: "web" }],
        metricValues: [{ value: "25" }, { value: "814" }],
      },
      {
        dimensionValues: [{ value: "20260809" }, { value: "android" }],
        metricValues: [{ value: "4" }, { value: "9" }],
      },
    ],
  };

  it("expands each row into one snapshot per mapped metric", () => {
    const out = parseDailyReport(report, DAILY_ACTIVES_MAP);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({
      scope: "web",
      metric: "activeUsers1d",
      value: 25,
      periodStart: new Date("2026-08-09T00:00:00.000Z"),
    });
    expect(out[3].scope).toBe("android");
  });

  it("ignores GA4 metrics that aren't in the map", () => {
    const out = parseDailyReport(report, { active1DayUsers: "activeUsers1d" });
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.metric === "activeUsers1d")).toBe(true);
  });

  it("skips bad rows instead of writing NaN", () => {
    const dirty = {
      ...report,
      rows: [
        {
          dimensionValues: [{ value: "not-a-date" }, { value: "web" }],
          metricValues: [{ value: "25" }, { value: "814" }],
        },
        {
          dimensionValues: [{ value: "20260809" }, { value: "web" }],
          metricValues: [{ value: "oops" }, { value: "814" }],
        },
      ],
    };
    const out = parseDailyReport(dirty, DAILY_ACTIVES_MAP);
    expect(out).toEqual([
      {
        scope: "web",
        metric: "activeUsers28d",
        value: 814,
        periodStart: new Date("2026-08-09T00:00:00.000Z"),
      },
    ]);
  });

  it("defaults scope to 'other' when there is no platform dimension", () => {
    const out = parseDailyReport(
      {
        dimensionHeaders: [{ name: "date" }],
        metricHeaders: [{ name: "active1DayUsers" }],
        rows: [
          { dimensionValues: [{ value: "20260809" }], metricValues: [{ value: "25" }] },
        ],
      },
      DAILY_ACTIVES_MAP,
    );
    expect(out[0].scope).toBe("other");
  });

  it("returns nothing when the date dimension is missing — the summed-rolling trap", () => {
    // A report without a `date` dimension returns SUMMED rolling actives
    // (34x inflated). Refusing to parse it makes that mistake unshippable.
    expect(
      parseDailyReport(
        {
          dimensionHeaders: [],
          metricHeaders: [{ name: "active1DayUsers" }],
          rows: [{ dimensionValues: [], metricValues: [{ value: "247" }] }],
        },
        DAILY_ACTIVES_MAP,
      ),
    ).toEqual([]);
  });
});

describe("formatExact", () => {
  it("groups thousands so a daily change stays visible", () => {
    expect(formatExact(7543)).toBe("7,543");
    // formatCount would render both of these as "7.5k".
    expect(formatExact(7557)).not.toBe(formatExact(7543));
  });

  it("leaves small numbers plain", () => {
    expect(formatExact(0)).toBe("0");
    expect(formatExact(842)).toBe("842");
  });

  it("rounds fractional input", () => {
    expect(formatExact(1234.6)).toBe("1,235");
  });
});
