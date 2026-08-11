import "server-only";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";
import { isGa4Configured } from "@/lib/ga4";
import {
  METRIC,
  NON_ADDITIVE,
  deltaPct,
  stickiness,
  type BreakdownKey,
  type MetricKey,
} from "./metrics";

// Read side of the product-analytics dashboard. Reads ONLY MetricSnapshot —
// never GA4 directly, so a 20s wall refresh costs no API quota and a Google
// outage shows a stale number rather than an error (see the MetricSnapshot
// model comment).

const SOURCE = "ga4";
const TREND_DAYS = 28;

export interface TrendPoint {
  /** UTC-midnight day the value describes, ISO yyyy-mm-dd. */
  date: string;
  dau: number;
  sessions: number;
}

export interface BreakdownSlice {
  label: string;
  value: number;
  /** Share of this breakdown's total, 0..100 — precomputed so the bar widths
   * don't need the total threaded through the component tree. */
  pct: number;
}

export interface ScopeMetrics {
  scope: "web" | "ios" | "android";
  dau: number;
  wau: number;
  mau: number;
  /** DAU/MAU as a percentage. Null when MAU is 0, and ALSO null until the
   * scope has a week of history — see MIN_DAYS_FOR_STICKINESS. */
  stickiness: number | null;
  /** Distinct days this scope has data for. A brand-new stream has 1. */
  daysWithData: number;
  /** Change in DAU vs the same metric 7 days earlier; null with no baseline. */
  dauDeltaPct: number | null;
  totalUsers: number;
  newUsers: number;
  sessions: number;
  pageViews: number;
  /** 0..1 as GA4 reports it. */
  /** Mean of the daily rates across the window, 0..1. An approximation:
   * GA4 doesn't expose per-day engagedSessions, so this can't be
   * session-weighted. Close enough for a trend indicator, not for billing. */
  engagementRate: number;
  /** Session-weighted across the window: total engagement seconds / total
   * sessions. Computed rather than read from GA4's averageSessionDuration,
   * whose per-day values can't be averaged without weighting. */
  avgSessionDuration: number;
  engagementHours: number;
  realtimeActive: number;
  /** Traffic-quality metrics, window-averaged (rates) or summed (counts). */
  bounceRate: number;
  engagedSessions: number;
  sessionsPerUser: number;
  viewsPerSession: number;
  eventCount: number;
  eventsPerUser: number;
  trend: TrendPoint[];
  /** Top slices per breakdown, already sorted desc and capped. */
  breakdowns: Record<BreakdownKey, BreakdownSlice[]>;
}

export interface AppInstalls {
  total: number;
  ios: number;
  android: number;
  /**
   * Where the number came from:
   *  "store"      — true installs from Play + App Store Connect (accurate,
   *                 lags 1-2 days, so it describes `day`, not today)
   *  "first_open" — GA4 proxy (live-ish today, undercounts: misses downloads
   *                 that were never opened)
   *  "none"       — neither source has data yet
   * The UI MUST label these differently; presenting a proxy as a store figure
   * is how a wall board ends up quietly wrong.
   */
  source: "store" | "first_open" | "none";
  /** UTC day the figure describes, ISO yyyy-mm-dd. Null when source is "none". */
  day: string | null;
}

export interface AnalyticsOverview {
  /** False when the GA4 env vars are absent — the page renders a setup notice
   * instead of a wall of zeros that looks like real (bad) data. */
  configured: boolean;
  /** When the sync last wrote. Drives the staleness badge; null before the
   * first successful run. */
  lastSyncedAt: Date | null;
  /** Most recent complete day present, ISO yyyy-mm-dd. GA4 finalises a day
   * with a lag, so this is normally yesterday, not today. */
  latestDay: string | null;
  /**
   * App installs so far TODAY, approximated by GA4's `first_open` event.
   *
   * NOT a true download count — GA4 has no install metric; real figures live in
   * Play Console / App Store Connect. `first_open` fires on the first launch
   * after install, so it misses downloads that were never opened. Labelled
   * accordingly in the UI.
   */
  appInstalls: AppInstalls;
  scopes: ScopeMetrics[];
}

type Row = {
  scope: string;
  metric: string;
  value: number;
  periodStart: Date;
  dimension: string;
  dimensionValue: string;
};

/** How many slices each breakdown card shows. Beyond this the tail is noise at
 * wall-viewing distance; the remainder is folded into "Other". */
const BREAKDOWN_LIMIT = 5;

/**
 * Stickiness (DAU/MAU) is meaningless until the 28-day window actually spans
 * more than a day or two: a stream with one day of data has DAU == WAU == MAU,
 * which renders as a triumphant "100%" that means nothing. The Mobile App
 * stream hit exactly this on its first day. Below this threshold we return null
 * and the UI shows "—".
 */
const MIN_DAYS_FOR_STICKINESS = 7;

function pick(rows: Row[], scope: string, metric: MetricKey, day: string): number {
  const hit = rows.find(
    (r) =>
      r.scope === scope &&
      r.metric === metric &&
      r.dimension === "" &&
      r.periodStart.toISOString().slice(0, 10) === day,
  );
  return hit?.value ?? 0;
}

/** Top-N slices for one breakdown, with the long tail folded into "Other" so
 * the percentages still add to 100 and nobody reads the card as the whole. */
function sliceBreakdown(rows: Row[], scope: string, dimension: BreakdownKey) {
  const all = rows
    .filter((r) => r.scope === scope && r.dimension === dimension)
    .sort((a, b) => b.value - a.value);

  const total = all.reduce((acc, r) => acc + r.value, 0);
  if (total <= 0) return [];

  const top = all.slice(0, BREAKDOWN_LIMIT);
  const rest = all.slice(BREAKDOWN_LIMIT).reduce((acc, r) => acc + r.value, 0);

  const slices = top.map((r) => ({
    label: r.dimensionValue,
    value: r.value,
    pct: Math.round((r.value / total) * 1000) / 10,
  }));

  if (rest > 0) {
    slices.push({
      label: "Other",
      value: rest,
      pct: Math.round((rest / total) * 1000) / 10,
    });
  }
  return slices;
}

/**
 * App installs, preferring real store figures over the GA4 proxy.
 *
 * Store data is authoritative but lags 1-2 days, so we take the most recent day
 * for which EITHER store reported, and report that day explicitly rather than
 * implying it's today. Only when no store data exists at all do we fall back to
 * GA4 `first_open` for today — clearly flagged, because the two are not the
 * same measurement.
 */
async function resolveAppInstalls(): Promise<AppInstalls> {
  const storeRows = await prisma.metricSnapshot.findMany({
    where: {
      source: { in: ["play", "appstore"] },
      metric: METRIC.storeInstalls,
      grain: "DAY",
    },
    orderBy: { periodStart: "desc" },
    take: 20,
    select: { source: true, value: true, periodStart: true },
  });

  if (storeRows.length > 0) {
    // Pin to the newest day EITHER store reported, then read each store's value
    // for that day — mixing days across stores would silently add a Monday
    // Android number to a Tuesday iOS one.
    const newestDay = storeRows[0].periodStart.toISOString().slice(0, 10);
    const sameDay = storeRows.filter(
      (r) => r.periodStart.toISOString().slice(0, 10) === newestDay,
    );
    const valueFrom = (source: string) =>
      sameDay
        .filter((r) => r.source === source)
        .reduce((acc, r) => acc + r.value, 0);

    const android = valueFrom("play");
    const ios = valueFrom("appstore");
    return { ios, android, total: ios + android, source: "store", day: newestDay };
  }

  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  const firstOpenRows = await prisma.metricSnapshot.findMany({
    where: {
      source: SOURCE,
      metric: METRIC.appFirstOpens,
      grain: "DAY",
      periodStart: todayUtc,
    },
    select: { dimensionValue: true, value: true },
  });

  const firstOpenBy = (platform: string) =>
    firstOpenRows
      .filter((r) => r.dimensionValue.toLowerCase() === platform)
      .reduce((acc, r) => acc + r.value, 0);

  const total = firstOpenRows.reduce((acc, r) => acc + r.value, 0);
  return {
    ios: firstOpenBy("ios"),
    android: firstOpenBy("android"),
    total,
    source: firstOpenRows.length > 0 ? "first_open" : "none",
    day: firstOpenRows.length > 0 ? todayUtc.toISOString().slice(0, 10) : null,
  };
}

/**
 * Everything the analytics board renders, in two queries. ADMIN-ONLY.
 *
 * Scopes are derived from what's actually stored rather than hardcoded, so the
 * app column appears by itself once app data starts flowing — no code change.
 */
export async function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  await requireAdmin();

  const configured = isGa4Configured();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - TREND_DAYS);
  since.setUTCHours(0, 0, 0, 0);

  const [daily, realtime] = await Promise.all([
    prisma.metricSnapshot.findMany({
      where: { source: SOURCE, grain: "DAY", periodStart: { gte: since } },
      orderBy: { periodStart: "asc" },
      select: {
        scope: true,
        metric: true,
        value: true,
        periodStart: true,
        dimension: true,
        dimensionValue: true,
      },
    }),
    // Newest INSTANT batch only. Ordered desc and grouped in memory — cheaper
    // than a correlated subquery for what is at most a handful of rows.
    prisma.metricSnapshot.findMany({
      where: { source: SOURCE, grain: "INSTANT" },
      orderBy: { periodStart: "desc" },
      take: 10,
      select: { scope: true, value: true, periodStart: true },
    }),
  ]);

  const appInstalls = await resolveAppInstalls();

  const lastSynced = await prisma.metricSnapshot.findFirst({
    where: { source: SOURCE },
    orderBy: { capturedAt: "desc" },
    select: { capturedAt: true },
  });

  // Breakdown rows share the DAY grain but describe the whole window, so they
  // must not contribute to the per-day axis.
  const scalarRows = daily.filter((r) => r.dimension === "");
  const days = [
    ...new Set(scalarRows.map((r) => r.periodStart.toISOString().slice(0, 10))),
  ].sort();
  const latestDay = days.at(-1) ?? null;
  // Same weekday a week earlier — a fair DAU comparison, since weekday and
  // weekend traffic differ enough that day-over-day would mostly measure that.
  const weekAgoDay = days.at(-8) ?? null;

  const realtimeNewest = realtime[0]?.periodStart.toISOString() ?? null;
  const realtimeByScope = new Map<string, number>();
  for (const r of realtime) {
    if (r.periodStart.toISOString() !== realtimeNewest) continue;
    realtimeByScope.set(r.scope, (realtimeByScope.get(r.scope) ?? 0) + r.value);
  }

  // iOS and Android are now stored separately (they used to be collapsed into
  // one "app" scope). This page shows all three as their own panels rather than
  // re-merging them: a merged panel would have to fake a blended engagement
  // rate, and the per-platform split is more useful here anyway.
  const SCOPE_ORDER = ["web", "ios", "android"] as const;
  const present = new Set(scalarRows.map((r) => r.scope));
  const presentScopes = SCOPE_ORDER.filter((s) => present.has(s));

  const scopes: ScopeMetrics[] = latestDay
    ? presentScopes.map((scope) => {
        const dau = pick(scalarRows, scope, METRIC.activeUsers1d, latestDay);
        const mau = pick(scalarRows, scope, METRIC.activeUsers28d, latestDay);
        const dauWeekAgo = weekAgoDay
          ? pick(scalarRows, scope, METRIC.activeUsers1d, weekAgoDay)
          : 0;

        // Days this scope actually reported, not the window length — a stream
        // that started yesterday has 1, however wide the query range was.
        const daysWithData = new Set(
          scalarRows
            .filter((r) => r.scope === scope)
            .map((r) => r.periodStart.toISOString().slice(0, 10)),
        ).size;

        const trend: TrendPoint[] = days.map((day) => ({
          date: day,
          dau: pick(scalarRows, scope, METRIC.activeUsers1d, day),
          sessions: pick(scalarRows, scope, METRIC.sessions, day),
        }));

        // Counts sum across the window; rates and per-user averages are meaned.
        // NON_ADDITIVE is the single source of truth for which is which, shared
        // with the sync so the two can never disagree.
        const windowValue = (metric: MetricKey) =>
          NON_ADDITIVE.has(metric) ? meanOver(metric) : sumOver(metric);

        // Sum the additive metrics across the window; point-in-time and rate
        // metrics are read from the latest day only (summing a rate is
        // meaningless, and summing rolling actives is the 34x trap).
        const valuesOf = (metric: MetricKey) =>
          scalarRows.filter((r) => r.scope === scope && r.metric === metric);

        const sumOver = (metric: MetricKey) =>
          valuesOf(metric).reduce((acc, r) => acc + r.value, 0);

        // Mean across days that actually have a row — dividing by the window
        // length would drag the average down for a metric that only started
        // being collected partway through (exactly the app streams' case).
        const meanOver = (metric: MetricKey) => {
          const rows = valuesOf(metric);
          if (rows.length === 0) return 0;
          return rows.reduce((acc, r) => acc + r.value, 0) / rows.length;
        };

        return {
          scope,
          dau,
          wau: pick(scalarRows, scope, METRIC.activeUsers7d, latestDay),
          mau,
          stickiness:
            daysWithData >= MIN_DAYS_FOR_STICKINESS ? stickiness(dau, mau) : null,
          daysWithData,
          dauDeltaPct: deltaPct(dau, dauWeekAgo),
          totalUsers: mau,
          newUsers: sumOver(METRIC.newUsers),
          sessions: sumOver(METRIC.sessions),
          pageViews: sumOver(METRIC.screenPageViews),
          engagementRate: meanOver(METRIC.engagementRate),
          avgSessionDuration:
            sumOver(METRIC.sessions) > 0
              ? sumOver(METRIC.engagementDuration) / sumOver(METRIC.sessions)
              : 0,
          engagementHours:
            Math.round((sumOver(METRIC.engagementDuration) / 3600) * 10) / 10,
          realtimeActive: realtimeByScope.get(scope) ?? 0,
          bounceRate: windowValue(METRIC.bounceRate),
          engagedSessions: windowValue(METRIC.engagedSessions),
          sessionsPerUser: windowValue(METRIC.sessionsPerUser),
          viewsPerSession: windowValue(METRIC.viewsPerSession),
          eventCount: windowValue(METRIC.eventCount),
          eventsPerUser: windowValue(METRIC.eventsPerUser),
          trend,
          breakdowns: {
            country: sliceBreakdown(daily, scope, "country"),
            channel: sliceBreakdown(daily, scope, "channel"),
            device: sliceBreakdown(daily, scope, "device"),
          },
        };
      })
    : [];

  return {
    configured,
    lastSyncedAt: lastSynced?.capturedAt ?? null,
    latestDay,
    appInstalls,
    scopes,
  };
}
