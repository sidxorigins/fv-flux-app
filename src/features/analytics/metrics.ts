// Pure analytics shaping. No server imports, no "use client" — unit-testable
// without a database or a network call (see metrics.test.ts), and importable
// from either side (per features/tasks/format.ts's convention).

/** Our metric vocabulary. Deliberately NOT GA4's names — the UI and the DB
 * speak this, so a vendor rename or a second source never reaches the board. */
export const METRIC = {
  activeUsers1d: "activeUsers1d",
  activeUsers7d: "activeUsers7d",
  activeUsers28d: "activeUsers28d",
  totalUsers: "totalUsers",
  newUsers: "newUsers",
  sessions: "sessions",
  screenPageViews: "screenPageViews",
  engagementRate: "engagementRate",
  avgSessionDuration: "avgSessionDuration",
  engagementDuration: "engagementDuration",
  realtimeActiveUsers: "realtimeActiveUsers",
  // Quality-of-traffic metrics — all verified populated on the live property.
  bounceRate: "bounceRate",
  engagedSessions: "engagedSessions",
  sessionsPerUser: "sessionsPerUser",
  viewsPerSession: "viewsPerSession",
  eventCount: "eventCount",
  eventsPerUser: "eventsPerUser",
  // Breakdown metric: users split by a dimension (country/channel/device).
  usersByDimension: "usersByDimension",
  // App installs, approximated by GA4's `first_open` event.
  //
  // NOT a true download count: GA4 has no install metric at all (installs live
  // in Play Console / App Store Connect). `first_open` fires on the first
  // LAUNCH after an install, so it undercounts downloads that were never
  // opened and lags them by however long the user waits to open the app.
  // Named `appFirstOpens`, not `appDownloads`, so nothing downstream can
  // mistake it for the real figure.
  appFirstOpens: "appFirstOpens",
  // TRUE installs, straight from Google Play / App Store Connect. Unlike
  // appFirstOpens this is what the stores themselves report — but it lags
  // 1-2 days, so the two coexist rather than one replacing the other.
  storeInstalls: "storeInstalls",
  // CUMULATIVE lifetime installs from a store, computed from non-overlapping
  // yearly + monthly + daily reports. Stored as its own metric rather than
  // summing storeInstalls rows, because those only cover a rolling window —
  // and mixing period grains would double-count.
  storeInstallsLifetime: "storeInstallsLifetime",
  // Window aggregates stored once per sync (periodStart = window start), not
  // per day — used by the TV board's "last 6 months" figures.
  engagementTime180d: "engagementTime180d",
  activeUsers180d: "activeUsers180d",
  totalUsersAllTime: "totalUsersAllTime",
  firstOpensAllTime: "firstOpensAllTime",
} as const;

export type MetricKey = (typeof METRIC)[keyof typeof METRIC];

/** GA4 metric name → our key, for the daily rolling-actives report. */
export const DAILY_ACTIVES_MAP: Record<string, MetricKey> = {
  active1DayUsers: METRIC.activeUsers1d,
  active7DayUsers: METRIC.activeUsers7d,
  active28DayUsers: METRIC.activeUsers28d,
};

/** GA4 metric name → our key, for the daily totals report. */
export const DAILY_TOTALS_MAP: Record<string, MetricKey> = {
  totalUsers: METRIC.totalUsers,
  newUsers: METRIC.newUsers,
  sessions: METRIC.sessions,
  screenPageViews: METRIC.screenPageViews,
  engagementRate: METRIC.engagementRate,
  averageSessionDuration: METRIC.avgSessionDuration,
  userEngagementDuration: METRIC.engagementDuration,
  bounceRate: METRIC.bounceRate,
  engagedSessions: METRIC.engagedSessions,
  sessionsPerUser: METRIC.sessionsPerUser,
  screenPageViewsPerSession: METRIC.viewsPerSession,
  eventCount: METRIC.eventCount,
  eventCountPerUser: METRIC.eventsPerUser,
};

/** Which GA4 metrics are RATES or PER-USER AVERAGES rather than counts.
 * Summing these across platforms or days is meaningless — the sync and the
 * read layer both consult this instead of hardcoding the list twice. */
export const NON_ADDITIVE: ReadonlySet<MetricKey> = new Set([
  METRIC.engagementRate,
  METRIC.avgSessionDuration,
  METRIC.bounceRate,
  METRIC.sessionsPerUser,
  METRIC.viewsPerSession,
  METRIC.eventsPerUser,
  METRIC.activeUsers1d,
  METRIC.activeUsers7d,
  METRIC.activeUsers28d,
]);

/** Breakdown dimensions we store, keyed by our own short name. */
export const BREAKDOWN = {
  country: "country",
  channel: "channel",
  device: "device",
} as const;

export type BreakdownKey = (typeof BREAKDOWN)[keyof typeof BREAKDOWN];

/** Our breakdown name → the GA4 dimension it comes from. */
export const BREAKDOWN_DIMENSION: Record<BreakdownKey, string> = {
  country: "country",
  channel: "sessionDefaultChannelGroup",
  device: "deviceCategory",
};

/**
 * GA4's `platform` dimension → our scope.
 *
 * iOS and Android are kept SEPARATE rather than collapsed into "app": the wall
 * board shows them side by side, and a collapsed store can't be un-collapsed
 * later. The combined "app" figure is derived at read time by summing the two,
 * which is correct for counts and handled explicitly for rates.
 *
 * GA4 returns these capitalised ("Android", "iOS"), hence the lowercasing.
 * Anything unrecognised becomes "other" so it is still recorded rather than
 * silently dropped or miscounted as web.
 */
export type Scope = "web" | "android" | "ios" | "other";

export function platformToScope(platform: string): Scope {
  const p = platform.toLowerCase();
  if (p === "web") return "web";
  if (p === "android") return "android";
  if (p === "ios") return "ios";
  return "other";
}

/** The two platforms that make up the combined "app" view. */
export const APP_SCOPES = ["ios", "android"] as const;

/**
 * GA4 returns dates as "YYYYMMDD" strings in the PROPERTY's timezone
 * (Asia/Calcutta here). We normalise to that calendar day at UTC midnight —
 * the value labels a day, not an instant, so shifting it into a real timezone
 * would only invite off-by-one bugs when the office (Dubai) reads it.
 *
 * Returns null for anything that isn't 8 digits, so a malformed row is skipped
 * rather than producing an Invalid Date row in the DB.
 */
export function ga4DateToUtc(yyyymmdd: string): Date | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejects real-looking-but-invalid dates like 20260231, which Date.UTC would
  // silently roll forward into March.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/** Truncate an instant to the minute — the period key for INSTANT snapshots,
 * so a sync firing twice in the same minute upserts instead of duplicating. */
export function truncateToMinute(d: Date): Date {
  const out = new Date(d);
  out.setUTCSeconds(0, 0);
  return out;
}

/**
 * Stickiness — the share of monthly users who show up on a given day.
 * Returns null (not 0) when MAU is zero, so the UI can render "—" rather than
 * an authoritative-looking 0%.
 */
export function stickiness(dau: number, mau: number): number | null {
  if (mau <= 0) return null;
  return Math.round((dau / mau) * 1000) / 10;
}

/** Percentage change vs a previous value. Null when there's no meaningful
 * baseline — a jump from 0 is not "+100%", it's undefined. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** "6m 04s" / "58s" — engagement durations read at a glance on a wall. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/**
 * Exact count with thousand separators: 7543 → "7,543".
 *
 * Used where a day-to-day change has to be visible. `formatCount` would render
 * both 7,543 and 7,557 as "7.5k", hiding exactly the movement someone is
 * watching the board for.
 */
export function formatExact(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

/** Compact display for large counts on a wall display: 27768 → "27.8k". */
export function formatCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export interface ParsedSnapshot {
  scope: Scope;
  metric: MetricKey;
  value: number;
  periodStart: Date;
}

/**
 * Turn a GA4 report into snapshot rows.
 *
 * Expects dimensions in the order [date, platform?] — the shape both daily
 * reports use. Rows with an unparseable date or a non-numeric value are
 * SKIPPED rather than written as NaN: one bad row must not poison a sync.
 *
 * `metricMap` decides which GA4 metrics are kept, so an extra metric in the
 * response is ignored rather than stored under a vendor name.
 */
export function parseDailyReport(
  report: {
    dimensionHeaders?: { name: string }[];
    metricHeaders?: { name: string }[];
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  },
  metricMap: Record<string, MetricKey>,
): ParsedSnapshot[] {
  const dimNames = (report.dimensionHeaders ?? []).map((h) => h.name);
  const metricNames = (report.metricHeaders ?? []).map((h) => h.name);
  const dateIdx = dimNames.indexOf("date");
  const platformIdx = dimNames.indexOf("platform");
  if (dateIdx === -1) return [];

  const out: ParsedSnapshot[] = [];

  for (const row of report.rows ?? []) {
    const periodStart = ga4DateToUtc(row.dimensionValues[dateIdx]?.value ?? "");
    if (!periodStart) continue;

    const scope: Scope =
      platformIdx === -1
        ? "other"
        : platformToScope(row.dimensionValues[platformIdx]?.value ?? "");

    metricNames.forEach((ga4Name, i) => {
      const metric = metricMap[ga4Name];
      if (!metric) return;
      const raw = Number(row.metricValues[i]?.value);
      if (!Number.isFinite(raw)) return;
      out.push({ scope, metric, value: raw, periodStart });
    });
  }

  return out;
}
