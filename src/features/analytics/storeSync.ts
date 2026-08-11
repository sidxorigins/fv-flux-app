import "server-only";

import { prisma } from "@/lib/db";
import {
  AscConfigError,
  fetchSalesReport,
  isAscConfigured,
} from "@/lib/appStoreConnect";
import {
  PlayConfigError,
  fetchInstallsCsv,
  isPlayConfigured,
} from "@/lib/playConsole";
import { METRIC } from "./metrics";
import { parseAscSalesTsv, parsePlayInstallsCsv } from "./storeReports";

// True store install counts — Google Play + App Store Connect.
//
// SEPARATE FROM GA4 for a reason: GA4's `first_open` is a proxy (it misses
// downloads that were never opened), whereas these are the figures the stores
// themselves report. Both sources land in MetricSnapshot under distinct
// `source` values so the UI can prefer store data and fall back to the proxy.
//
// LATENCY: both publish with a 1-2 day lag, so neither can answer "downloads
// today". The most recent COMPLETE day is the best either can do — which is
// why the GA4 proxy still earns its place on the board.

const SOURCE_PLAY = "play";
const SOURCE_ASC = "appstore";

/** First-run backfill: how far back to reach when we have no iOS history at
 * all. Apple serves daily reports for ~365 days; 90 gives a meaningful total
 * without 365 sequential requests on the first sync. */
const ASC_INITIAL_BACKFILL_DAYS = 90;

/** Steady state: re-fetch this many recent days every run. Apple revises recent
 * reports, so re-pulling a few days lets figures settle rather than freezing an
 * early estimate. */
const ASC_REFRESH_DAYS = 3;

/** Earliest year to look for App Store history. Apple 404s years before the
 * app existed, so an over-wide floor costs a few cheap 404s, not correctness. */
const ASC_HISTORY_FLOOR_YEAR = 2019;

/** Lifetime totals change slowly and cost ~15 requests to rebuild, so they are
 * refreshed on this cadence rather than every 5-minute cron tick. */
const LIFETIME_REFRESH_HOURS = 6;

/** Hard cap on requests per sync, so a long gap (or an empty table) can't fire
 * hundreds of sequential calls at Apple in one cron tick. */
const ASC_MAX_REQUESTS_PER_RUN = 90;

export interface StoreSyncResult {
  play: { ok: boolean; skipped?: boolean; days?: number; error?: string };
  appStore: { ok: boolean; skipped?: boolean; days?: number; error?: string };
  lifetime: { ok: boolean; skipped?: boolean; total?: number; error?: string };
}

function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yyyymm(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Replace a source's install rows for the given days. Delete-then-insert per
 * day keeps the sync idempotent and lets a revised figure overwrite an earlier
 * estimate.
 */
async function writeInstalls(
  source: string,
  rows: { periodStart: Date; installs: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  const capturedAt = new Date();

  await prisma.$transaction([
    prisma.metricSnapshot.deleteMany({
      where: {
        source,
        metric: METRIC.storeInstalls,
        grain: "DAY",
        periodStart: { in: rows.map((r) => r.periodStart) },
      },
    }),
    prisma.metricSnapshot.createMany({
      data: rows.map((r) => ({
        source,
        scope: "app",
        metric: METRIC.storeInstalls,
        dimension: "",
        dimensionValue: "",
        value: r.installs,
        grain: "DAY" as const,
        periodStart: r.periodStart,
        capturedAt,
      })),
    }),
  ]);
}

async function syncPlay(): Promise<StoreSyncResult["play"]> {
  if (!isPlayConfigured()) return { ok: true, skipped: true };

  try {
    const now = new Date();
    const prevMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );

    // Current + previous month: on the 1st-2nd of a month the only finalised
    // data still lives in the previous month's file.
    const files = await Promise.all([
      fetchInstallsCsv(yyyymm(now)),
      fetchInstallsCsv(yyyymm(prevMonth)),
    ]);

    const rows = files
      .filter((csv): csv is string => csv !== null)
      // DEVICE installs, matching scripts/import-play-csv.mts so a manual
      // import and the automated sync can never produce different numbers.
      .flatMap((csv) => parsePlayInstallsCsv(csv, "device"));

    await writeInstalls(SOURCE_PLAY, rows);
    return { ok: true, days: rows.length };
  } catch (err) {
    if (err instanceof PlayConfigError) return { ok: true, skipped: true };
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

async function syncAppStore(): Promise<StoreSyncResult["appStore"]> {
  if (!isAscConfigured()) return { ok: true, skipped: true };

  try {
    // Truly incremental: always TARGET the full window, then skip days already
    // stored — except the most recent few, which are re-fetched because Apple
    // revises them. An earlier version only backfilled when the table was
    // empty, which meant a partial history could never fill itself in.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const existing = await prisma.metricSnapshot.findMany({
      where: { source: SOURCE_ASC, metric: METRIC.storeInstalls, grain: "DAY" },
      select: { periodStart: true },
    });
    const have = new Set(
      existing.map((r) => r.periodStart.toISOString().slice(0, 10)),
    );

    const days: Date[] = [];
    for (let i = 1; i <= ASC_INITIAL_BACKFILL_DAYS; i++) {
      if (days.length >= ASC_MAX_REQUESTS_PER_RUN) break;
      // Start at yesterday: Apple has no finalised report for today.
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      // Always re-pull the refresh window; otherwise only fetch gaps.
      if (i > ASC_REFRESH_DAYS && have.has(key)) continue;
      days.push(d);
    }

    const reports = await Promise.all(
      days.map(async (day) => {
        const tsv = await fetchSalesReport(utcDayString(day));
        // null = Apple has no report for that date (routine: reports lag, and
        // zero-activity days are simply absent). Recording 0 would be a lie —
        // "no data" and "no downloads" are different states.
        return tsv === null
          ? null
          : { periodStart: day, installs: parseAscSalesTsv(tsv) };
      }),
    );

    const rows = reports.filter((r): r is NonNullable<typeof r> => r !== null);
    await writeInstalls(SOURCE_ASC, rows);
    return { ok: true, days: rows.length };
  } catch (err) {
    if (err instanceof AscConfigError) return { ok: true, skipped: true };
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

/**
 * Cumulative lifetime iOS installs, assembled from NON-OVERLAPPING periods:
 *   • YEARLY reports for every completed year
 *   • MONTHLY reports for completed months of the current year
 *   • DAILY reports for the current month so far
 *
 * Summing the stored `storeInstalls` daily rows would NOT work — they only
 * cover a rolling window. And naively adding yearly + monthly + daily for
 * overlapping periods would double-count, which is why the ranges here are
 * strictly partitioned.
 */
async function syncAppStoreLifetime(): Promise<{
  ok: boolean;
  skipped?: boolean;
  total?: number;
  error?: string;
}> {
  if (!isAscConfigured()) return { ok: true, skipped: true };

  try {
    // Rebuild at most every LIFETIME_REFRESH_HOURS — the figure barely moves
    // and each rebuild is ~15 API calls.
    const existing = await prisma.metricSnapshot.findFirst({
      where: { source: SOURCE_ASC, metric: METRIC.storeInstallsLifetime },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true, value: true },
    });
    if (
      existing &&
      Date.now() - existing.capturedAt.getTime() < LIFETIME_REFRESH_HOURS * 3600_000
    ) {
      return { ok: true, skipped: true, total: existing.value };
    }

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const periods: { date: string; frequency: "YEARLY" | "MONTHLY" | "DAILY" }[] = [];

    for (let y = ASC_HISTORY_FLOOR_YEAR; y < year; y++) {
      periods.push({ date: String(y), frequency: "YEARLY" });
    }
    for (let m = 1; m < month; m++) {
      periods.push({
        date: `${year}-${String(m).padStart(2, "0")}`,
        frequency: "MONTHLY",
      });
    }
    for (let d = 1; d <= now.getUTCDate(); d++) {
      periods.push({
        date: `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        frequency: "DAILY",
      });
    }

    const counts = await Promise.all(
      periods.map(async ({ date, frequency }) => {
        const tsv = await fetchSalesReport(date, frequency);
        return tsv === null ? 0 : parseAscSalesTsv(tsv);
      }),
    );
    const total = counts.reduce((acc, n) => acc + n, 0);

    // Single row, keyed to a fixed periodStart so it upserts in place rather
    // than accumulating one row per sync.
    const epoch = new Date(Date.UTC(1970, 0, 1));
    const capturedAt = new Date();
    await prisma.$transaction([
      prisma.metricSnapshot.deleteMany({
        where: { source: SOURCE_ASC, metric: METRIC.storeInstallsLifetime },
      }),
      prisma.metricSnapshot.create({
        data: {
          source: SOURCE_ASC,
          scope: "ios",
          metric: METRIC.storeInstallsLifetime,
          dimension: "",
          dimensionValue: "",
          value: total,
          grain: "DAY",
          periodStart: epoch,
          capturedAt,
        },
      }),
    ]);

    return { ok: true, total };
  } catch (err) {
    if (err instanceof AscConfigError) return { ok: true, skipped: true };
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

/** Pull both stores. Each is independent — one being unconfigured or failing
 * must never stop the other, or an expired Apple key would silently take
 * Android numbers off the board too. */
export async function syncStoreInstalls(): Promise<StoreSyncResult> {
  const [play, appStore, lifetime] = await Promise.all([
    syncPlay(),
    syncAppStore(),
    syncAppStoreLifetime(),
  ]);
  return { play, appStore, lifetime };
}
