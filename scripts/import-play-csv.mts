/**
 * Import a manually-downloaded Google Play installs CSV.
 *
 * Bridges the gap while the Play Console → Cloud Storage permission propagates
 * (Google documents up to 24h). Uses the SAME parser as the automated bucket
 * sync — features/analytics/storeReports.ts — so the numbers are identical to
 * what the cron will produce once it can read the bucket; this is not a
 * separate code path that could drift.
 *
 * Get the file from: Play Console → Download reports → Statistics → Installs
 *   (choose the "Country" dimension export)
 *
 * Usage:  npx tsx scripts/import-play-csv.mts <file.csv | directory> [...]
 *
 * Pass a DIRECTORY and every installs CSV inside it is imported in one go —
 * Play exports one file per month, and importing them individually is the kind
 * of chore that stops getting done.
 *
 * Idempotent: rows are deleted and re-inserted per day, so re-running with an
 * overlapping export corrects rather than duplicates.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "../src/lib/db";
import { parsePlayInstallsCsv } from "../src/features/analytics/storeReports";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: npx tsx scripts/import-play-csv.mts <file.csv | directory> [...]");
  process.exit(1);
}

// Expand directories to the installs CSVs inside them. Filtered by name so a
// folder containing ratings/reviews exports doesn't get parsed as installs and
// silently contribute zero rows.
const files = args.flatMap((arg) => {
  if (!statSync(arg).isDirectory()) return [arg];
  return readdirSync(arg)
    // Play's bucket names these `installs_<pkg>_YYYYMM_country.csv`, but the
    // Console's manual download prefixes the path: `stats_installs_installs_…`.
    // Match on "installs" anywhere rather than anchoring to the start, or the
    // manually-downloaded files are silently skipped.
    .filter((f) => /installs.*\.csv$/i.test(f))
    .sort()
    .map((f) => join(arg, f));
});

if (files.length === 0) {
  console.error("no installs_*.csv files found in the given path(s)");
  process.exit(1);
}
console.log(`importing ${files.length} file(s)\n`);

const all: { periodStart: Date; installs: number }[] = [];

for (const file of files) {
  const buf = readFileSync(file);
  // Play publishes these as UTF-16LE with a BOM; decoding as UTF-8 silently
  // yields an empty parse rather than an error.
  const isUtf16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
  const text = isUtf16 ? buf.toString("utf16le").replace(/^﻿/, "") : buf.toString("utf8");

  // DEVICE installs — the larger figure (a user with a phone and a tablet
  // counts twice). Matches the default used by the automated bucket sync so
  // the two never disagree.
  const rows = parsePlayInstallsCsv(text, "device");
  console.log(`${file}: ${rows.length} days (${isUtf16 ? "UTF-16LE" : "UTF-8"})`);
  if (rows.length === 0) {
    console.log("  ⚠ nothing parsed — check this is the INSTALLS export, not reviews/ratings");
  }
  all.push(...rows);
}

if (all.length === 0) {
  console.error("no rows parsed, nothing written");
  process.exit(1);
}

// Collapse duplicate days across overlapping exports (last file wins).
const byDay = new Map<number, number>();
for (const r of all) byDay.set(r.periodStart.getTime(), r.installs);
const rows = [...byDay.entries()]
  .sort(([a], [b]) => a - b)
  .map(([t, installs]) => ({ periodStart: new Date(t), installs }));

const capturedAt = new Date();
await prisma.$transaction([
  prisma.metricSnapshot.deleteMany({
    where: {
      source: "play",
      metric: "storeInstalls",
      grain: "DAY",
      periodStart: { in: rows.map((r) => r.periodStart) },
    },
  }),
  prisma.metricSnapshot.createMany({
    data: rows.map((r) => ({
      source: "play",
      scope: "android",
      metric: "storeInstalls",
      dimension: "",
      dimensionValue: "",
      value: r.installs,
      grain: "DAY" as const,
      periodStart: r.periodStart,
      capturedAt,
    })),
  }),
]);

const total = rows.reduce((a, r) => a + r.installs, 0);
console.log(
  `\n✓ imported ${rows.length} days · ${rows[0].periodStart.toISOString().slice(0, 10)} → ${rows.at(-1)!.periodStart.toISOString().slice(0, 10)}`,
);
console.log(`  total Android installs: ${total}`);

await prisma.$disconnect();
