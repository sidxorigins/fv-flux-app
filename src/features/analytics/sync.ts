import "server-only";

import { prisma } from "@/lib/db";
import {
  Ga4ConfigError,
  PRODUCTION_HOST,
  runRealtimeReport,
  runReport,
} from "@/lib/ga4";
import {
  BREAKDOWN,
  BREAKDOWN_DIMENSION,
  DAILY_ACTIVES_MAP,
  DAILY_TOTALS_MAP,
  METRIC,
  NON_ADDITIVE,
  parseDailyReport,
  platformToScope,
  truncateToMinute,
  type BreakdownKey,
  type ParsedSnapshot,
} from "./metrics";

// GA4 → MetricSnapshot sync. Called by /api/cron/metrics-sync ONLY — no read
// path ever calls GA4 directly (see the MetricSnapshot model comment for why).

const SOURCE = "ga4";

/** How much history to (re)fetch each run. 28 days covers the longest rolling
 * window we display and lets late-arriving GA4 data self-correct: GA4 keeps
 * revising recent days for ~48h, so re-pulling the window each time means the
 * board converges on the final numbers instead of freezing an early estimate. */
const DAILY_WINDOW_DAYS = 28;

/** INSTANT rows land once a minute; without pruning that's ~525k rows/year of
 * data nobody looks back at. A week is plenty for a "last hour" sparkline. */
const INSTANT_RETENTION_DAYS = 7;

/**
 * Production traffic only. Web is pinned to the real hostname — the property
 * is polluted with a developer's localhost, raw EC2 IPs, the ELB hostname and
 * the Google Translate proxy. App traffic carries no hostName at all, so it's
 * OR'd in by platform or it would be filtered away entirely.
 *
 * Verified against the live property: this filter is accepted alongside the
 * rolling activeNDayUsers metrics (GA4 rejects some such combinations).
 */
const PRODUCTION_FILTER = {
  orGroup: {
    expressions: [
      {
        filter: {
          fieldName: "hostName",
          stringFilter: { matchType: "EXACT", value: PRODUCTION_HOST },
        },
      },
      {
        filter: {
          fieldName: "platform",
          inListFilter: { values: ["android", "ios"] },
        },
      },
    ],
  },
};

const DATE_AND_PLATFORM = [{ name: "date" }, { name: "platform" }];

export interface SyncResult {
  ok: boolean;
  skipped?: "not_configured";
  dailyRows?: number;
  breakdownRows?: number;
  firstOpenRows?: number;
  aggregateRows?: number;
  realtimeRows?: number;
  prunedInstants?: number;
  error?: string;
}

/**
 * Pull GA4 into MetricSnapshot. Idempotent: the daily window is replaced
 * wholesale inside a transaction, so a retry after a partial failure
 * self-heals rather than double-counting.
 *
 * CRITICAL: both daily reports request a `date` dimension. Without it GA4
 * SUMS the rolling activeNDayUsers metrics across the range — during setup
 * that reported MAU as 27,768 instead of 814, a 34x overstatement.
 * `parseDailyReport` refuses to parse a report with no date dimension, so this
 * can't regress silently.
 */
export async function syncGa4Metrics(): Promise<SyncResult> {
  try {
    const windowStart = new Date();
    windowStart.setUTCDate(windowStart.getUTCDate() - DAILY_WINDOW_DAYS);
    windowStart.setUTCHours(0, 0, 0, 0);

    const dateRanges = [
      { startDate: `${DAILY_WINDOW_DAYS}daysAgo`, endDate: "yesterday" },
    ];

    // GA4 caps a request at 10 metrics, so the totals are split across two
    // reports rather than one — verified against the live API, which rejects
    // 13 metrics with INVALID_ARGUMENT.
    const [actives, totalsA, totalsB, realtime] = await Promise.all([
      runReport({
        dateRanges,
        dimensions: DATE_AND_PLATFORM,
        metrics: [
          { name: "active1DayUsers" },
          { name: "active7DayUsers" },
          { name: "active28DayUsers" },
        ],
        dimensionFilter: PRODUCTION_FILTER,
      }),
      runReport({
        dateRanges,
        dimensions: DATE_AND_PLATFORM,
        metrics: [
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "engagementRate" },
          { name: "averageSessionDuration" },
          { name: "userEngagementDuration" },
        ],
        dimensionFilter: PRODUCTION_FILTER,
      }),
      runReport({
        dateRanges,
        dimensions: DATE_AND_PLATFORM,
        metrics: [
          { name: "bounceRate" },
          { name: "engagedSessions" },
          { name: "sessionsPerUser" },
          { name: "screenPageViewsPerSession" },
          { name: "eventCount" },
          { name: "eventCountPerUser" },
        ],
        dimensionFilter: PRODUCTION_FILTER,
      }),
      // Realtime has no hostName dimension, so it can't be host-filtered.
      // Localhost dev traffic can leak in here; acceptable for a "right now"
      // number, and it self-corrects in the daily figures.
      runRealtimeReport({
        dimensions: [{ name: "platform" }],
        metrics: [{ name: "activeUsers" }],
      }),
    ]);

    // App first-opens for TODAY, kept separate from the main window (which
    // ends "yesterday" so it only ever holds finalised days). Today's figure is
    // partial by definition — it's a "so far today" counter, and GA4 keeps
    // revising it — which is exactly what a live wall board wants.
    const firstOpensToday = await runReport({
      dateRanges: [{ startDate: "today", endDate: "today" }],
      dimensions: [{ name: "platform" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "eventName",
                stringFilter: { matchType: "EXACT", value: "first_open" },
              },
            },
            {
              filter: {
                fieldName: "platform",
                inListFilter: { values: ["android", "ios"] },
              },
            },
          ],
        },
      },
    });

    // Window aggregates for the TV board: 6-month engagement and all-time
    // totals. Stored once per sync at periodStart = their own window start,
    // NOT per day — these answer "over the whole period", so a per-day split
    // would be meaningless and 180x the rows.
    //
    // Verified against the live property: 180 days is inside GA4's retention
    // here (data goes back to Aug 2025).
    const [sixMonth, allTime, firstOpensAllTime] = await Promise.all([
      runReport({
        dateRanges: [{ startDate: "180daysAgo", endDate: "yesterday" }],
        dimensions: [{ name: "platform" }],
        metrics: [{ name: "userEngagementDuration" }, { name: "activeUsers" }],
        dimensionFilter: PRODUCTION_FILTER,
      }),
      runReport({
        dateRanges: [{ startDate: "365daysAgo", endDate: "today" }],
        dimensions: [{ name: "platform" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: PRODUCTION_FILTER,
      }),
      runReport({
        dateRanges: [{ startDate: "365daysAgo", endDate: "today" }],
        dimensions: [{ name: "platform" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            stringFilter: { matchType: "EXACT", value: "first_open" },
          },
        },
      }),
    ]);

    // Breakdowns are stored for the WINDOW as a whole (one periodStart =
    // windowStart), not per day: the cards show "top countries over 28 days",
    // and a per-day split would be 28x the rows for no extra insight.
    const breakdownKeys = Object.keys(BREAKDOWN) as BreakdownKey[];
    const breakdownReports = await Promise.all(
      breakdownKeys.map((key) =>
        runReport({
          dateRanges,
          dimensions: [{ name: BREAKDOWN_DIMENSION[key] }, { name: "platform" }],
          metrics: [{ name: "totalUsers" }],
          dimensionFilter: PRODUCTION_FILTER,
          orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
          limit: 40,
        }).then((report) => ({ key, report })),
      ),
    );

    const daily: ParsedSnapshot[] = [
      ...parseDailyReport(actives, DAILY_ACTIVES_MAP),
      ...parseDailyReport(totalsA, DAILY_TOTALS_MAP),
      ...parseDailyReport(totalsB, DAILY_TOTALS_MAP),
    ];

    const capturedAt = new Date();
    const instantPeriod = truncateToMinute(capturedAt);

    const realtimeRows = (realtime.rows ?? [])
      .map((row) => {
        const value = Number(row.metricValues[0]?.value);
        if (!Number.isFinite(value)) return null;
        return {
          source: SOURCE,
          scope: platformToScope(row.dimensionValues[0]?.value ?? ""),
          metric: METRIC.realtimeActiveUsers,
          value,
          grain: "INSTANT" as const,
          periodStart: instantPeriod,
          capturedAt,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Collapse duplicate (scope, metric) pairs — GA4 can return android and
    // ios as separate rows that both map to scope "app", and they'd violate
    // the unique key. Summing is correct: they're disjoint user sets.
    const realtimeByScope = new Map<string, (typeof realtimeRows)[number]>();
    for (const row of realtimeRows) {
      const key = `${row.scope}:${row.metric}`;
      const existing = realtimeByScope.get(key);
      if (existing) existing.value += row.value;
      else realtimeByScope.set(key, row);
    }
    const dedupedRealtime = [...realtimeByScope.values()];

    // Same collapse for the daily rows: android + ios both map to "app".
    const dailyByKey = new Map<string, ParsedSnapshot>();
    for (const row of daily) {
      const key = `${row.scope}:${row.metric}:${row.periodStart.toISOString()}`;
      const existing = dailyByKey.get(key);
      if (existing) {
        // Rates, per-user averages and rolling actives can't be summed across
        // platforms — keep the first (larger-cohort) value rather than
        // producing a nonsense >100% rate or an inflated MAU.
        if (!NON_ADDITIVE.has(row.metric)) existing.value += row.value;
      } else {
        dailyByKey.set(key, { ...row });
      }
    }
    const dedupedDaily = [...dailyByKey.values()];

    // One row per platform so the card can show the iOS/Android split; the UI
    // sums them. Stored under scope "app" with the platform in dimensionValue.
    const todayUtc = new Date(capturedAt);
    todayUtc.setUTCHours(0, 0, 0, 0);
    const firstOpenRows = (firstOpensToday.rows ?? [])
      .map((row) => {
        const value = Number(row.metricValues[0]?.value);
        const platform = row.dimensionValues[0]?.value ?? "";
        if (!Number.isFinite(value) || !platform) return null;
        return {
          source: SOURCE,
          scope: "app",
          metric: METRIC.appFirstOpens,
          dimension: "platform",
          dimensionValue: platform,
          value,
          grain: "DAY" as const,
          periodStart: todayUtc,
          capturedAt,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Window aggregates → rows. All share periodStart = windowStart so the
    // existing delete-in-window keeps them idempotent.
    const aggregateRows: {
      source: string;
      scope: string;
      metric: string;
      dimension: string;
      dimensionValue: string;
      value: number;
      grain: "DAY";
      periodStart: Date;
      capturedAt: Date;
    }[] = [];

    const pushAggregate = (
      report: { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] },
      metricKeys: string[],
    ) => {
      for (const row of report.rows ?? []) {
        const scope = platformToScope(row.dimensionValues[0]?.value ?? "");
        metricKeys.forEach((metric, i) => {
          const value = Number(row.metricValues[i]?.value);
          if (!Number.isFinite(value)) return;
          aggregateRows.push({
            source: SOURCE,
            scope,
            metric,
            dimension: "",
            dimensionValue: "",
            value,
            grain: "DAY",
            periodStart: windowStart,
            capturedAt,
          });
        });
      }
    };

    pushAggregate(sixMonth, [METRIC.engagementTime180d, METRIC.activeUsers180d]);
    pushAggregate(allTime, [METRIC.totalUsersAllTime]);
    pushAggregate(firstOpensAllTime, [METRIC.firstOpensAllTime]);

    // Flatten breakdown reports into rows, collapsing android+ios into "app".
    const breakdownRows = new Map<
      string,
      {
        source: string;
        scope: string;
        metric: string;
        dimension: string;
        dimensionValue: string;
        value: number;
        grain: "DAY";
        periodStart: Date;
        capturedAt: Date;
      }
    >();
    for (const { key, report } of breakdownReports) {
      for (const row of report.rows ?? []) {
        const dimensionValue = row.dimensionValues[0]?.value?.trim();
        // "(not set)" and blanks are noise on a wall board, not a country.
        if (!dimensionValue || dimensionValue === "(not set)") continue;
        const value = Number(row.metricValues[0]?.value);
        if (!Number.isFinite(value)) continue;

        const scope = platformToScope(row.dimensionValues[1]?.value ?? "");
        const mapKey = `${scope}:${key}:${dimensionValue}`;
        const existing = breakdownRows.get(mapKey);
        if (existing) {
          existing.value += value;
          continue;
        }
        breakdownRows.set(mapKey, {
          source: SOURCE,
          scope,
          metric: METRIC.usersByDimension,
          dimension: key,
          dimensionValue,
          value,
          grain: "DAY",
          periodStart: windowStart,
          capturedAt,
        });
      }
    }

    // Replace-in-window rather than per-row upsert: ~560 upserts would be 560
    // round-trips. Wrapped in a transaction so readers never observe the gap.
    await prisma.$transaction([
      prisma.metricSnapshot.deleteMany({
        where: { source: SOURCE, grain: "DAY", periodStart: { gte: windowStart } },
      }),
      prisma.metricSnapshot.createMany({
        data: dedupedDaily.map((row) => ({
          source: SOURCE,
          scope: row.scope,
          metric: row.metric,
          value: row.value,
          grain: "DAY" as const,
          periodStart: row.periodStart,
          capturedAt,
        })),
      }),
      prisma.metricSnapshot.createMany({ data: [...breakdownRows.values()] }),
      prisma.metricSnapshot.createMany({ data: firstOpenRows }),
      prisma.metricSnapshot.createMany({ data: aggregateRows }),
      prisma.metricSnapshot.deleteMany({
        where: {
          source: SOURCE,
          grain: "INSTANT",
          periodStart: instantPeriod,
        },
      }),
      prisma.metricSnapshot.createMany({ data: dedupedRealtime }),
    ]);

    const instantCutoff = new Date();
    instantCutoff.setUTCDate(instantCutoff.getUTCDate() - INSTANT_RETENTION_DAYS);
    const pruned = await prisma.metricSnapshot.deleteMany({
      where: { grain: "INSTANT", periodStart: { lt: instantCutoff } },
    });

    return {
      ok: true,
      dailyRows: dedupedDaily.length,
      breakdownRows: breakdownRows.size,
      firstOpenRows: firstOpenRows.length,
      aggregateRows: aggregateRows.length,
      realtimeRows: dedupedRealtime.length,
      prunedInstants: pruned.count,
    };
  } catch (err) {
    if (err instanceof Ga4ConfigError) {
      return { ok: true, skipped: "not_configured" };
    }
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}
