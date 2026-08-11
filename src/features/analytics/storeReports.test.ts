import { describe, expect, it } from "vitest";

import {
  parseAscSalesTsv,
  parsePlayInstallsCsv,
  splitCsvLine,
} from "./storeReports";

describe("splitCsvLine", () => {
  it("keeps commas inside quoted fields", () => {
    expect(splitCsvLine('2026-08-09,"Bonaire, Sint Eustatius",5')).toEqual([
      "2026-08-09",
      "Bonaire, Sint Eustatius",
      "5",
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
  });
});

describe("parsePlayInstallsCsv", () => {
  const csv = [
    "Date,Package Name,Country,Daily Device Installs,Daily User Installs",
    "2026-08-08,com.foodverseapp,AE,10,8",
    "2026-08-08,com.foodverseapp,IN,5,4",
    "2026-08-09,com.foodverseapp,AE,3,3",
  ].join("\n");

  it("sums country rows into one total per day", () => {
    const out = parsePlayInstallsCsv(csv);
    expect(out).toEqual([
      { periodStart: new Date("2026-08-08T00:00:00.000Z"), installs: 15 },
      { periodStart: new Date("2026-08-09T00:00:00.000Z"), installs: 3 },
    ]);
  });

  it("counts DEVICE installs by default", () => {
    // Device column: 10 + 5 = 15 for 08-08. User column would give 12.
    expect(parsePlayInstallsCsv(csv)[0].installs).toBe(15);
  });

  it("counts USER installs when asked", () => {
    expect(parsePlayInstallsCsv(csv, "user")[0].installs).toBe(12);
  });

  it("falls back to the other column when the preferred one is absent", () => {
    const userOnly = [
      "Date,Package Name,Country,Daily User Installs",
      "2026-08-08,com.foodverseapp,AE,10",
    ].join("\n");
    // Asked for device, only user exists — parse it rather than returning [].
    expect(parsePlayInstallsCsv(userOnly)[0].installs).toBe(10);
  });

  it("matches columns by name, not position", () => {
    const reordered = [
      "Country,Daily Device Installs,Date,Package Name",
      "AE,7,2026-08-08,com.foodverseapp",
    ].join("\n");
    expect(parsePlayInstallsCsv(reordered)).toEqual([
      { periodStart: new Date("2026-08-08T00:00:00.000Z"), installs: 7 },
    ]);
  });

  it("skips malformed rows rather than emitting NaN", () => {
    const dirty = [
      "Date,Daily Device Installs",
      "not-a-date,5",
      "2026-08-08,oops",
      "2026-08-08,4",
    ].join("\n");
    expect(parsePlayInstallsCsv(dirty)).toEqual([
      { periodStart: new Date("2026-08-08T00:00:00.000Z"), installs: 4 },
    ]);
  });

  it("returns [] for an empty or headerless file", () => {
    expect(parsePlayInstallsCsv("")).toEqual([]);
    expect(parsePlayInstallsCsv("Date,Something\n2026-08-08,3")).toEqual([]);
  });
});

describe("parseAscSalesTsv", () => {
  const tsv = [
    "Provider\tSKU\tProduct Type Identifier\tUnits\tCountry Code",
    "APPLE\tfoodverse\t1\t12\tAE",
    "APPLE\tfoodverse\t1F\t3\tIN",
    "APPLE\tfoodverse\t7\t99\tAE", // update — must NOT count
    "APPLE\tfoodverse\t3\t40\tAE", // re-download — must NOT count
  ].join("\n");

  it("counts only first-time download product types", () => {
    expect(parseAscSalesTsv(tsv)).toBe(15);
  });

  it("excludes updates and re-downloads, the classic overcount", () => {
    // 12 + 3 + 99 + 40 = 154 if the type filter were missing.
    expect(parseAscSalesTsv(tsv)).not.toBe(154);
  });

  it("is case-insensitive on the type code", () => {
    const lower = ["Product Type Identifier\tUnits", "1f\t6"].join("\n");
    expect(parseAscSalesTsv(lower)).toBe(6);
  });

  it("returns 0 for reports with no download rows", () => {
    const updatesOnly = ["Product Type Identifier\tUnits", "7\t50"].join("\n");
    expect(parseAscSalesTsv(updatesOnly)).toBe(0);
  });

  it("returns 0 rather than throwing on an empty or unexpected report", () => {
    expect(parseAscSalesTsv("")).toBe(0);
    expect(parseAscSalesTsv("Some\tOther\tHeader\nx\ty\tz")).toBe(0);
  });
});
