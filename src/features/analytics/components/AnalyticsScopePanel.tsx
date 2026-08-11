import {
  Activity,
  Clock,
  Globe,
  Layers,
  MousePointerClick,
  Radio,
  Repeat,
  Smartphone,
  Sparkles,
  TrendingDown,
  Users,
} from "lucide-react";

import { BreakdownCard } from "./BreakdownCard";
import { HeroStat, StatTile } from "./StatCard";
import { TrendChart } from "./TrendChart";
import { formatCount, formatDuration } from "@/features/analytics/metrics";
import type { AppInstalls, ScopeMetrics } from "@/features/analytics/queries";
import { cn } from "@/lib/utils";

// One traffic source (Website or Mobile App) as a bento block: hero row of
// read-across-the-room numbers, trend, dense supporting tiles, then breakdowns.
//
// Server component throughout except TrendChart (Recharts needs the DOM).
// No entrance animation — per CLAUDE.md the board "looks great sitting
// perfectly still", and this re-renders on a 60s poll where replayed motion
// would read as a data change that didn't happen.

const SCOPE_LABEL: Record<ScopeMetrics["scope"], string> = {
  web: "Website",
  ios: "iOS App",
  android: "Android App",
};

export function AnalyticsScopePanel({
  metrics,
  appInstalls,
  wall = false,
}: {
  metrics: ScopeMetrics;
  /** App-wide, not scope-specific — the same figure shows on every panel
   * because installs are one org-level number, not per traffic source. */
  appInstalls: AppInstalls;
  wall?: boolean;
}) {
  const live = metrics.realtimeActive > 0;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2
          className={cn(
            "text-foreground font-semibold tracking-tight",
            wall ? "text-3xl" : "text-lg",
          )}
        >
          {SCOPE_LABEL[metrics.scope]}
        </h2>

        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1",
            wall ? "text-base" : "text-xs",
            live
              ? "bg-success/10 text-success"
              : "bg-surface-raised text-muted-foreground",
          )}
        >
          <Radio aria-hidden className={wall ? "size-4" : "size-3"} />
          {live ? `${metrics.realtimeActive} active now` : "nobody active"}
        </span>
      </header>

      {/* Hero row — the four numbers worth reading from across the office */}
      <div className={cn("grid gap-3", wall ? "grid-cols-4 gap-4" : "sm:grid-cols-4")}>
        <HeroStat
          wall={wall}
          label="Daily active"
          value={formatCount(metrics.dau)}
          delta={metrics.dauDeltaPct}
          sublabel="vs last week"
          tone="info"
        />
        <HeroStat wall={wall} label="Weekly active" value={formatCount(metrics.wau)} />
        <HeroStat wall={wall} label="Monthly active" value={formatCount(metrics.mau)} />
        <HeroStat
          wall={wall}
          // Label states WHICH measurement this is. A store figure and a GA4
          // first-open proxy are different numbers; calling both "installs
          // today" is how a wall board ends up quietly misleading.
          label={
            appInstalls.source === "store"
              ? "App installs"
              : "App first opens today"
          }
          value={formatCount(appInstalls.total)}
          sublabel={
            appInstalls.source === "none"
              ? "awaiting store data"
              : `iOS ${appInstalls.ios} · Android ${appInstalls.android}${
                  appInstalls.source === "store" ? ` · ${appInstalls.day}` : ""
                }`
          }
          tone="success"
        />
      </div>

      <div className={cn("glass", wall ? "p-6" : "p-5")}>
        <h3
          className={cn(
            "text-muted-foreground mb-2 font-medium tracking-wider uppercase",
            wall ? "text-sm" : "text-[11px]",
          )}
        >
          Daily active users · 28 days
        </h3>
        <TrendChart data={metrics.trend} metric="dau" wall={wall} />
      </div>

      {/* Dense supporting grid, explicitly windowed so a 28-day total is never
          misread as a daily figure on a wall. */}
      <div className="flex flex-col gap-3">
        <span
          className={cn(
            "text-muted-foreground font-medium tracking-wider uppercase",
            wall ? "text-sm" : "text-[11px]",
          )}
        >
          Last 28 days
        </span>
        <div
          className={cn(
            "grid gap-3",
            wall ? "grid-cols-5" : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5",
          )}
        >
          <StatTile
            wall={wall}
            icon={Sparkles}
            label="New users"
            value={formatCount(metrics.newUsers)}
          />
          <StatTile
            wall={wall}
            icon={Activity}
            label="Sessions"
            value={formatCount(metrics.sessions)}
          />
          <StatTile
            wall={wall}
            icon={Layers}
            label="Views"
            value={formatCount(metrics.pageViews)}
          />
          <StatTile
            wall={wall}
            icon={MousePointerClick}
            label="Events"
            value={formatCount(metrics.eventCount)}
          />
          <StatTile
            wall={wall}
            icon={Users}
            label="Engaged sessions"
            value={formatCount(metrics.engagedSessions)}
          />
          <StatTile
            wall={wall}
            icon={Clock}
            label="Avg session"
            value={formatDuration(metrics.avgSessionDuration)}
          />
          <StatTile
            wall={wall}
            icon={Activity}
            label="Engagement"
            value={`${Math.round(metrics.engagementRate * 100)}%`}
            tone={metrics.engagementRate >= 0.5 ? "success" : "default"}
          />
          <StatTile
            wall={wall}
            icon={TrendingDown}
            label="Bounce rate"
            value={`${Math.round(metrics.bounceRate * 100)}%`}
            tone={metrics.bounceRate > 0.6 ? "warning" : "default"}
          />
          <StatTile
            wall={wall}
            icon={Repeat}
            label="Sessions / user"
            value={metrics.sessionsPerUser.toFixed(1)}
          />
          <StatTile
            wall={wall}
            icon={Layers}
            label="Views / session"
            value={metrics.viewsPerSession.toFixed(1)}
          />
          <StatTile
            wall={wall}
            icon={Users}
            label="Stickiness"
            // "—" until the stream has a week of history: DAU/MAU on a
            // one-day-old stream is always 100% and means nothing.
            value={metrics.stickiness === null ? "—" : `${metrics.stickiness}%`}
          />
        </div>
      </div>

      <div className={cn("grid gap-3", wall ? "grid-cols-3 gap-4" : "lg:grid-cols-3")}>
        <BreakdownCard
          wall={wall}
          icon={Globe}
          title="Top countries"
          slices={metrics.breakdowns.country}
        />
        <BreakdownCard
          wall={wall}
          icon={Sparkles}
          title="Traffic sources"
          slices={metrics.breakdowns.channel}
        />
        <BreakdownCard
          wall={wall}
          icon={Smartphone}
          title="Devices"
          slices={metrics.breakdowns.device}
        />
      </div>
    </section>
  );
}
