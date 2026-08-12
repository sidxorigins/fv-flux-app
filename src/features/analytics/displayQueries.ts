import "server-only";

import { prisma } from "@/lib/db";
import { METRIC } from "./metrics";

// Read model for the 16:9 wall board (/display). Separate from queries.ts on
// purpose: the TV shows a fixed, curated set of figures with an iOS/Android
// split, whereas /admin/analytics is a scrollable per-scope deep dive. Sharing
// one shape would force both to compromise.
//
// Reads MetricSnapshot only — never GA4 — so a 20s refresh costs no API quota.

const SOURCE = "ga4";

export interface PlatformSlice {
  scope: "ios" | "android";
  label: string;
  dau: number;
  mau: number;
  users: number;
  sessions: number;
  engagementRate: number;
  avgSessionDuration: number;
  realtimeActive: number;
  opensToday: number;
}

export interface DisplayMetrics {
  configured: boolean;
  lastSyncedAt: Date | null;
  latestDay: string | null;

  /** Monthly actives — the rolling 28-day figure, per surface. */
  mau: { web: number; app: number; ios: number; android: number };

  /** App downloads.
   *
   * `source`: "store" = real figures from App Store Connect / Play; "ga4_users"
   * = the interim proxy (total app users GA4 has seen), close to the installed
   * base but NOT a download count.
   *
   * `iosAvailable` / `androidAvailable` distinguish "measured as zero" from
   * "not measured at all". Rendering an unwired platform as 0 would be a
   * wall-sized lie — Android reads 0 today only because the Play grant is
   * pending, not because nobody installed it.
   *
   * `coverage` is the date range the store total actually spans, so a 90-day
   * number is never presented as a lifetime one. */
  downloads: {
    ios: number;
    android: number;
    total: number;
    source: "store" | "ga4_users";
    iosAvailable: boolean;
    androidAvailable: boolean;
    coverage: { from: string; to: string } | null;
  };

  /** Engagement rate 0..1, latest complete day. */
  engagement: { web: number; app: number };

  /** Average engagement time PER ACTIVE USER, seconds. Derived as total
   * engagement duration / active users — GA4 has no direct "average
   * engagement time per user over N months" metric.
   *
   * `appDays` / `webDays` are how many days of data actually underpin each
   * figure. The 180-day query returns whatever exists, so a stream created
   * yesterday yields a ONE-DAY average — labelling that "6mo" would be a lie,
   * and the UI uses these counts to caption the card honestly. */
  avgEngagement180d: {
    web: number;
    app: number;
    webDays: number;
    appDays: number;
  };

  /** App opens so far today: GA4 `first_open` events, iOS + Android. */
  opensToday: { ios: number; android: number; total: number };

  platforms: PlatformSlice[];
  webRealtime: number;
  trend: { date: string; web: number; app: number }[];
  countries: { label: string; value: number; pct: number }[];
}

type Row = {
  scope: string;
  metric: string;
  value: number;
  periodStart: Date;
  dimension: string;
  dimensionValue: string;
};

const APP = ["ios", "android"] as const;

/** Metrics that describe a whole window rather than a single day. Stored once
 * per sync at the window's start, so they must not be filtered by the rolling
 * day cutoff. */
const WINDOW_METRICS = [
  METRIC.engagementTime180d,
  METRIC.activeUsers180d,
  METRIC.totalUsersAllTime,
  METRIC.firstOpensAllTime,
] as const;

function latest(rows: Row[], scope: string, metric: string, day: string | null): number {
  if (!day) return 0;
  return (
    rows.find(
      (r) =>
        r.scope === scope &&
        r.metric === metric &&
        r.dimension === "" &&
        r.periodStart.toISOString().slice(0, 10) === day,
    )?.value ?? 0
  );
}

/** Window aggregate (6-month / all-time rows), which carry no per-day meaning. */
function aggregate(rows: Row[], scope: string, metric: string): number {
  return rows
    .filter((r) => r.scope === scope && r.metric === metric && r.dimension === "")
    .reduce((acc, r) => acc + r.value, 0);
}

const sumApp = (fn: (scope: string) => number) =>
  APP.reduce((acc, s) => acc + fn(s), 0);

export async function getDisplayMetrics(): Promise<DisplayMetrics> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 28);
  since.setUTCHours(0, 0, 0, 0);

  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  const snapshotSelect = {
    scope: true,
    metric: true,
    value: true,
    periodStart: true,
    dimension: true,
    dimensionValue: true,
  } as const;

  const [perDayRows, contextRows, realtimeRows, storeRows, lastSynced] =
    await Promise.all([
      // Per-day series. These genuinely describe a day, so the 28-day window
      // is the right filter.
      prisma.metricSnapshot.findMany({
        where: {
          source: SOURCE,
          grain: "DAY",
          dimension: "",
          periodStart: { gte: since },
        },
        select: snapshotSelect,
      }),
      // Breakdowns and window aggregates describe a PERIOD, and are stamped at
      // the window's start — i.e. ~28 days ago. Filtering them by the same
      // rolling cutoff drops them the moment the clock passes the last sync,
      // silently emptying the country, engagement and lifetime cards. Fetched
      // without a date bound and reduced to the newest set below.
      prisma.metricSnapshot.findMany({
        where: {
          source: SOURCE,
          grain: "DAY",
          OR: [{ dimension: { not: "" } }, { metric: { in: [...WINDOW_METRICS] } }],
        },
        orderBy: { periodStart: "desc" },
        select: snapshotSelect,
      }),
      prisma.metricSnapshot.findMany({
        where: { source: SOURCE, grain: "INSTANT" },
        orderBy: { periodStart: "desc" },
        take: 10,
        select: { scope: true, value: true, periodStart: true },
      }),
      prisma.metricSnapshot.findMany({
        where: {
          source: { in: ["play", "appstore"] },
          metric: { in: [METRIC.storeInstalls, METRIC.storeInstallsLifetime] },
          grain: "DAY",
        },
        select: { source: true, metric: true, value: true, periodStart: true },
      }),
      prisma.metricSnapshot.findFirst({
        where: { source: SOURCE },
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      }),
    ]);

  // Keep only the most recent set PER DIMENSION. Grouping matters: these row
  // types are stamped differently — breakdowns at the window start (~28 days
  // ago), first-opens at today — so a single "newest overall" cutoff keeps one
  // and silently discards the other. Old windows also linger, because the sync
  // only deletes forward from its own windowStart.
  const newestPerDimension = new Map<string, string>();
  for (const row of contextRows) {
    const iso = row.periodStart.toISOString();
    const seen = newestPerDimension.get(row.dimension);
    if (!seen || iso > seen) newestPerDimension.set(row.dimension, iso);
  }
  const rows = [
    ...perDayRows,
    ...contextRows.filter(
      (r) => r.periodStart.toISOString() === newestPerDimension.get(r.dimension),
    ),
  ];

  // Per-day scalar rows only — window aggregates and breakdowns share the DAY
  // grain but describe a period, so they must not define the day axis.
  const perDayMetrics = new Set<string>([
    METRIC.activeUsers1d,
    METRIC.activeUsers28d,
    METRIC.sessions,
    METRIC.engagementRate,
    METRIC.avgSessionDuration,
  ]);
  const scalarRows = rows.filter(
    (r) => r.dimension === "" && perDayMetrics.has(r.metric),
  );
  const days = [
    ...new Set(scalarRows.map((r) => r.periodStart.toISOString().slice(0, 10))),
  ].sort();
  const latestDay = days.at(-1) ?? null;

  // Newest realtime batch only.
  const newestInstant = realtimeRows[0]?.periodStart.toISOString() ?? null;
  const realtimeBy = (scope: string) =>
    realtimeRows
      .filter((r) => r.periodStart.toISOString() === newestInstant && r.scope === scope)
      .reduce((acc, r) => acc + r.value, 0);

  // App opens today, from the per-platform first_open rows.
  const opensRows = rows.filter(
    (r) =>
      r.metric === METRIC.appFirstOpens &&
      r.periodStart.toISOString() === todayUtc.toISOString(),
  );
  const opensBy = (platform: string) =>
    opensRows
      .filter((r) => r.dimensionValue.toLowerCase() === platform)
      .reduce((acc, r) => acc + r.value, 0);
  const opensToday = {
    ios: opensBy("ios"),
    android: opensBy("android"),
    total: opensRows.reduce((acc, r) => acc + r.value, 0),
  };

  // Downloads: real store figures when present, else the GA4 user-count proxy.
  // Lifetime rows take precedence over the rolling-window daily rows. Summing
  // BOTH would double-count, so they are read as alternatives, never added.
  const lifetimeRows = storeRows.filter(
    (r) => r.metric === METRIC.storeInstallsLifetime,
  );
  const windowRows = storeRows.filter((r) => r.metric === METRIC.storeInstalls);

  const lifetimeFor = (source: string) =>
    lifetimeRows.find((r) => r.source === source)?.value ?? null;
  const windowFor = (source: string) =>
    windowRows.filter((r) => r.source === source).reduce((acc, r) => acc + r.value, 0);

  const iosLifetime = lifetimeFor("appstore");
  const androidLifetime = lifetimeFor("play");

  const iosRows = windowRows.filter((r) => r.source === "appstore");
  const androidRows = windowRows.filter((r) => r.source === "play");

  const storeIos = iosLifetime ?? windowFor("appstore");
  const storeAndroid = androidLifetime ?? windowFor("play");

  // Coverage is only meaningful for the rolling window. Once a lifetime figure
  // exists there is no "since" to caveat — it IS the whole history.
  const isLifetime = iosLifetime !== null || androidLifetime !== null;
  const storeDays = windowRows
    .map((r) => r.periodStart.toISOString().slice(0, 10))
    .sort();

  const downloads =
    storeRows.length > 0
      ? {
          ios: storeIos,
          android: storeAndroid,
          total: storeIos + storeAndroid,
          source: "store" as const,
          iosAvailable: iosRows.length > 0 || iosLifetime !== null,
          androidAvailable: androidRows.length > 0 || androidLifetime !== null,
          coverage:
            isLifetime || storeDays.length === 0
              ? null
              : { from: storeDays[0]!, to: storeDays.at(-1)! },
        }
      : {
          ios: aggregate(rows, "ios", METRIC.totalUsersAllTime),
          android: aggregate(rows, "android", METRIC.totalUsersAllTime),
          total: sumApp((s) => aggregate(rows, s, METRIC.totalUsersAllTime)),
          source: "ga4_users" as const,
          iosAvailable: true,
          androidAvailable: true,
          coverage: null,
        };

  /** Engagement seconds per active user across the 180-day window. Guarded
   * against a zero denominator, which a brand-new platform will have. */
  const avgEngagementFor = (scopes: readonly string[]) => {
    const seconds = scopes.reduce(
      (acc, s) => acc + aggregate(rows, s, METRIC.engagementTime180d),
      0,
    );
    const users = scopes.reduce(
      (acc, s) => acc + aggregate(rows, s, METRIC.activeUsers180d),
      0,
    );
    return users > 0 ? seconds / users : 0;
  };

  // Rates can't be summed across platforms. Weighting by that platform's DAU
  // gives the true blended rate rather than an unweighted mean that lets a
  // tiny platform swing the headline.
  const blendedAppRate = (metric: string) => {
    const weights = APP.map((s) => ({
      value: latest(scalarRows, s, metric, latestDay),
      weight: latest(scalarRows, s, METRIC.activeUsers1d, latestDay),
    }));
    const totalWeight = weights.reduce((acc, w) => acc + w.weight, 0);
    if (totalWeight === 0) return 0;
    return weights.reduce((acc, w) => acc + w.value * w.weight, 0) / totalWeight;
  };

  const platforms: PlatformSlice[] = APP.map((scope) => ({
    scope,
    label: scope === "ios" ? "iOS" : "Android",
    dau: latest(scalarRows, scope, METRIC.activeUsers1d, latestDay),
    mau: latest(scalarRows, scope, METRIC.activeUsers28d, latestDay),
    users: aggregate(rows, scope, METRIC.totalUsersAllTime),
    sessions: rows
      .filter(
        (r) => r.scope === scope && r.metric === METRIC.sessions && r.dimension === "",
      )
      .reduce((acc, r) => acc + r.value, 0),
    engagementRate: latest(scalarRows, scope, METRIC.engagementRate, latestDay),
    avgSessionDuration: latest(scalarRows, scope, METRIC.avgSessionDuration, latestDay),
    realtimeActive: realtimeBy(scope),
    opensToday: opensBy(scope),
  }));

  // How many distinct days each surface actually reported. Drives the honest
  // caption on the engagement card.
  const daysFor = (scopes: readonly string[]) =>
    new Set(
      scalarRows
        .filter((r) => scopes.includes(r.scope))
        .map((r) => r.periodStart.toISOString().slice(0, 10)),
    ).size;

  const trend = days.map((day) => ({
    date: day,
    web: latest(scalarRows, "web", METRIC.activeUsers1d, day),
    app: sumApp((s) => latest(scalarRows, s, METRIC.activeUsers1d, day)),
  }));

  // Countries across every surface — one ranked list, not three.
  const countryRows = rows.filter((r) => r.dimension === "country");
  const countryTotals = new Map<string, number>();
  for (const r of countryRows) {
    countryTotals.set(
      r.dimensionValue,
      (countryTotals.get(r.dimensionValue) ?? 0) + r.value,
    );
  }
  const countryTotal = [...countryTotals.values()].reduce((a, b) => a + b, 0);
  // FOUR, not five: at 1080p minus browser chrome a fifth row clipped the
  // card by ~10px. The wall board must never truncate a row, and the 5th
  // country is a rounding error at this traffic level anyway.
  const countries = [...countryTotals.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([label, value]) => ({
      label,
      value,
      pct: countryTotal > 0 ? Math.round((value / countryTotal) * 1000) / 10 : 0,
    }));

  return {
    configured: rows.length > 0,
    lastSyncedAt: lastSynced?.capturedAt ?? null,
    latestDay,
    mau: {
      web: latest(scalarRows, "web", METRIC.activeUsers28d, latestDay),
      app: sumApp((s) => latest(scalarRows, s, METRIC.activeUsers28d, latestDay)),
      ios: latest(scalarRows, "ios", METRIC.activeUsers28d, latestDay),
      android: latest(scalarRows, "android", METRIC.activeUsers28d, latestDay),
    },
    downloads,
    engagement: {
      web: latest(scalarRows, "web", METRIC.engagementRate, latestDay),
      app: blendedAppRate(METRIC.engagementRate),
    },
    avgEngagement180d: {
      web: avgEngagementFor(["web"]),
      app: avgEngagementFor(APP),
      webDays: daysFor(["web"]),
      appDays: daysFor(APP),
    },
    opensToday,
    platforms,
    webRealtime: realtimeBy("web"),
    trend,
    countries,
  };
}
