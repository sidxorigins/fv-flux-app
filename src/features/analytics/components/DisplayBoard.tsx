import Image from "next/image";
import { Activity, Clock, Download, Radio, Smartphone, Users } from "lucide-react";

import { DisplayTrendChart } from "./DisplayTrendChart";
import { formatCount, formatDuration, formatExact } from "@/features/analytics/metrics";
import type { DisplayMetrics } from "@/features/analytics/displayQueries";
import { cn } from "@/lib/utils";

// 16:9 wall board. THE governing constraint is that nothing scrolls: the whole
// thing must fit one 1920x1080 viewport at reading-across-the-room type sizes.
//
// How that's achieved:
//  - the page is `h-screen overflow-hidden`, and this grid uses `fr` rows, so
//    the layout divides the viewport rather than summing up to exceed it
//  - every font size is `clamp(min, vw-relative, max)` so text scales with the
//    screen instead of wrapping or overflowing on a different panel size
//  - counts are abbreviated (28k, not 27,768) so a big number can't widen a
//    card past its track
//
// Server component apart from the chart. No entrance animation: this re-renders
// on a poll, and replayed motion on a wall reads as a data change.

export function DisplayBoard({ data }: { data: DisplayMetrics }) {
  const appLive = data.platforms.reduce((acc, p) => acc + p.realtimeActive, 0);
  const liveTotal = appLive + data.webRealtime;

  // Prefer the app figure, falling back to web — and carry the matching day
  // count so the label describes the number actually shown.
  const useApp = data.avgEngagement180d.app > 0;
  const engagementValue = useApp
    ? data.avgEngagement180d.app
    : data.avgEngagement180d.web;
  const engagementDays = useApp
    ? data.avgEngagement180d.appDays
    : data.avgEngagement180d.webDays;

  return (
    <div className="grid h-screen grid-rows-[auto_1.15fr_1.35fr_1fr] gap-[1.2vh] overflow-hidden p-[1.6vh]">
      {/* ── Header */}
      <header className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          {/* Sized in vh so it scales with the board rather than fighting the
              fr-row layout. `priority` because it is the only above-the-fold
              image on a screen that never scrolls — lazy-loading it would show
              an empty header on every refresh. */}
          <Image
            src="/foodverse-logo.png"
            alt="Foodverse"
            width={720}
            height={455}
            priority
            className="w-auto object-contain"
            style={{ height: "clamp(2.5rem, 7.5vh, 6.5rem)" }}
          />
          {/* The logo carries the brand visually; this keeps the page's
              heading structure intact for assistive tech. */}
          <h1 className="sr-only">Foodverse analytics wall board</h1>
          <span
            className="text-muted-foreground"
            style={{ fontSize: "clamp(0.75rem, 1vw, 1.25rem)" }}
          >
            {data.latestDay ? `data through ${data.latestDay}` : "no data"}
          </span>
        </div>

        <div className="flex items-center gap-5">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-1",
              liveTotal > 0
                ? "bg-success/10 text-success"
                : "bg-surface-raised text-muted-foreground",
            )}
            style={{ fontSize: "clamp(0.8rem, 1.05vw, 1.35rem)" }}
          >
            <Radio aria-hidden className="size-[1.1em]" />
            {liveTotal} online now
          </span>
          <span
            className="text-muted-foreground tabular-nums"
            style={{ fontSize: "clamp(0.7rem, 0.9vw, 1.1rem)" }}
          >
            {data.lastSyncedAt
              ? data.lastSyncedAt.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </span>
        </div>
      </header>

      {/* ── Row 1: the five headline metrics */}
      <div className="grid grid-cols-5 gap-[1.2vh]">
        <Hero
          icon={Users}
          label="Monthly active users"
          value={formatCount(data.mau.web + data.mau.app)}
          split={`Web ${formatCount(data.mau.web)} · App ${formatCount(data.mau.app)}`}
          tone="info"
        />
        <Hero
          icon={Download}
          // Labelled by what it actually measures, and by the period it covers.
          // A 90-day store total must not wear a "total downloads" label, and
          // an unwired platform must read "pending", never 0.
          label={
            data.downloads.source === "store"
              ? data.downloads.coverage
                ? "App downloads"
                : "Total app downloads"
              : "Total app users"
          }
          // EXACT, not abbreviated: this is the number people watch move day
          // to day, and formatCount would render 7,543 and 7,557 identically.
          value={formatExact(data.downloads.total)}
          split={[
            data.downloads.iosAvailable
              ? `iOS ${formatExact(data.downloads.ios)}`
              : "iOS pending",
            data.downloads.androidAvailable
              ? `Android ${formatExact(data.downloads.android)}`
              : "Android pending",
            data.downloads.coverage ? `since ${data.downloads.coverage.from}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          tone="primary"
        />
        <Hero
          icon={Activity}
          label="Engagement rate"
          value={`${Math.round(data.engagement.app * 100 || data.engagement.web * 100)}%`}
          split={`Web ${Math.round(data.engagement.web * 100)}% · App ${Math.round(data.engagement.app * 100)}%`}
          tone="success"
        />
        <Hero
          icon={Clock}
          // Caption the ACTUAL span, not the query window. The 180-day query
          // returns whatever exists, so a stream created yesterday yields a
          // one-day average — calling that "6mo" would misrepresent it.
          label={
            engagementDays >= 90
              ? "Avg engagement · 6mo"
              : `Avg engagement · ${engagementDays}d`
          }
          value={formatDuration(engagementValue)}
          split="per active user"
          tone="warning"
        />
        <Hero
          icon={Smartphone}
          label="App opens today"
          value={formatCount(data.opensToday.total)}
          split={`iOS ${data.opensToday.ios} · Android ${data.opensToday.android}`}
          tone="success"
        />
      </div>

      {/* ── Row 2: trend + per-platform detail */}
      <div className="grid grid-cols-[1.9fr_1fr_1fr] gap-[1.2vh] overflow-hidden">
        <section className="glass flex flex-col overflow-hidden p-[1.6vh]">
          <h2
            className="text-muted-foreground mb-[0.8vh] font-medium tracking-wider uppercase"
            style={{ fontSize: "clamp(0.65rem, 0.85vw, 1rem)" }}
          >
            Daily active users · 28 days
          </h2>
          <div className="min-h-0 flex-1">
            <DisplayTrendChart data={data.trend} />
          </div>
        </section>

        {data.platforms.map((p) => (
          <section
            key={p.scope}
            className="glass flex flex-col justify-between overflow-hidden p-[1.6vh]"
          >
            <div className="flex items-center justify-between gap-2">
              <h2
                className="text-foreground font-semibold"
                style={{ fontSize: "clamp(1rem, 1.4vw, 1.9rem)" }}
              >
                {p.label}
              </h2>
              {p.realtimeActive > 0 ? (
                <span
                  className="text-success inline-flex items-center gap-1.5"
                  style={{ fontSize: "clamp(0.7rem, 0.9vw, 1.1rem)" }}
                >
                  <span aria-hidden className="bg-success size-[0.5em] rounded-full" />
                  {p.realtimeActive}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-[0.6vh]">
              <Mini label="DAU" value={formatCount(p.dau)} />
              <Mini label="MAU" value={formatCount(p.mau)} />
              <Mini label="Users" value={formatCount(p.users)} />
              <Mini label="Sessions" value={formatCount(p.sessions)} />
              <Mini label="Engaged" value={`${Math.round(p.engagementRate * 100)}%`} />
              <Mini label="Avg sess" value={formatDuration(p.avgSessionDuration)} />
            </div>
          </section>
        ))}
      </div>

      {/* ── Row 3: geography + surface comparison */}
      <div className="grid grid-cols-[1.9fr_2fr] gap-[1.2vh] overflow-hidden">
        <section className="glass flex flex-col overflow-hidden p-[1.6vh]">
          <h2
            className="text-muted-foreground mb-[0.8vh] font-medium tracking-wider uppercase"
            style={{ fontSize: "clamp(0.65rem, 0.85vw, 1rem)" }}
          >
            Top countries
          </h2>
          <ul className="flex min-h-0 flex-1 flex-col justify-around">
            {data.countries.map((c) => (
              <li key={c.label} className="flex flex-col gap-[0.4vh]">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="text-foreground truncate"
                    style={{ fontSize: "clamp(0.75rem, 1vw, 1.3rem)" }}
                  >
                    {c.label}
                  </span>
                  <span
                    className="text-muted-foreground shrink-0 tabular-nums"
                    style={{ fontSize: "clamp(0.7rem, 0.9vw, 1.15rem)" }}
                  >
                    {formatCount(c.value)} · {c.pct}%
                  </span>
                </div>
                <div className="bg-surface-raised h-[0.8vh] w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${Math.max(c.pct, 1.5)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="glass grid grid-cols-2 gap-[1.2vh] overflow-hidden p-[1.6vh]">
          <SurfaceSummary
            title="Website"
            mau={data.mau.web}
            engagement={data.engagement.web}
            avg={data.avgEngagement180d.web}
            live={data.webRealtime}
          />
          <SurfaceSummary
            title="Mobile App"
            mau={data.mau.app}
            engagement={data.engagement.app}
            avg={data.avgEngagement180d.app}
            live={data.platforms.reduce((a, p) => a + p.realtimeActive, 0)}
          />
        </section>
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  primary: "text-primary",
  default: "text-foreground",
};

function Hero({
  icon: Icon,
  label,
  value,
  split,
  tone = "default",
}: {
  icon: typeof Users;
  label: string;
  value: string;
  split: string;
  tone?: keyof typeof TONE | string;
}) {
  return (
    <div className="glass flex flex-col justify-between overflow-hidden p-[1.6vh]">
      <span
        className="text-muted-foreground inline-flex items-center gap-2 font-medium tracking-wider uppercase"
        style={{ fontSize: "clamp(0.6rem, 0.8vw, 1rem)" }}
      >
        <Icon aria-hidden className="size-[1.2em] shrink-0" />
        <span className="truncate">{label}</span>
      </span>

      <span
        className={cn("font-semibold tabular-nums tracking-tight", TONE[tone])}
        style={{ fontSize: "clamp(2rem, 4.2vw, 6rem)", lineHeight: 1 }}
      >
        {value}
      </span>

      <span
        className="text-muted-foreground truncate"
        style={{ fontSize: "clamp(0.65rem, 0.85vw, 1.05rem)" }}
      >
        {split}
      </span>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span
        className="text-muted-foreground"
        style={{ fontSize: "clamp(0.6rem, 0.75vw, 0.9rem)" }}
      >
        {label}
      </span>
      <span
        className="text-foreground font-semibold tabular-nums"
        style={{ fontSize: "clamp(0.9rem, 1.3vw, 1.8rem)" }}
      >
        {value}
      </span>
    </div>
  );
}

function SurfaceSummary({
  title,
  mau,
  engagement,
  avg,
  live,
}: {
  title: string;
  mau: number;
  engagement: number;
  avg: number;
  live: number;
}) {
  return (
    <div className="bg-surface flex flex-col justify-between rounded-xl p-[1.4vh]">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-foreground font-semibold"
          style={{ fontSize: "clamp(0.85rem, 1.15vw, 1.5rem)" }}
        >
          {title}
        </span>
        {live > 0 ? (
          <span
            className="text-success inline-flex items-center gap-1.5"
            style={{ fontSize: "clamp(0.65rem, 0.85vw, 1rem)" }}
          >
            <span aria-hidden className="bg-success size-[0.5em] rounded-full" />
            {live}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Mini label="MAU" value={formatCount(mau)} />
        <Mini label="Engaged" value={`${Math.round(engagement * 100)}%`} />
        <Mini label="Avg 6mo" value={formatDuration(avg)} />
      </div>
    </div>
  );
}
