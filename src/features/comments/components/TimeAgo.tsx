"use client";

import * as React from "react";

// Relative timestamp with zero new dependencies. To avoid an SSR/client
// hydration mismatch (the server's "now" differs from the browser's), we render
// a deterministic absolute label during SSR + hydration and upgrade to the
// relative label ("2 hours ago") only once mounted on the client.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Deterministic, locale-independent "Jul 16" — identical on server and client. */
function absolute(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

function relative(from: Date, now: Date): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  let duration = (from.getTime() - now.getTime()) / 1000; // seconds, negative = past
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return absolute(from);
}

// `useSyncExternalStore` gives a mismatch-free "am I mounted on the client?"
// signal (server snapshot false, client snapshot true) without a setState-in-
// effect. Stable module-level callbacks avoid needless re-subscription.
const noopSubscribe = () => () => {};
const getIsMounted = () => true;
const getIsMountedServer = () => false;

export function TimeAgo({
  date,
  className,
}: {
  date: Date | string;
  className?: string;
}) {
  const d = React.useMemo(
    () => (typeof date === "string" ? new Date(date) : date),
    [date],
  );
  const mounted = React.useSyncExternalStore(
    noopSubscribe,
    getIsMounted,
    getIsMountedServer,
  );

  return (
    <time dateTime={d.toISOString()} className={className} suppressHydrationWarning>
      {mounted ? relative(d, new Date()) : absolute(d)}
    </time>
  );
}
