"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TrendPoint } from "@/features/analytics/queries";

// Client component ONLY because Recharts needs the DOM. Data arrives
// pre-shaped and pre-gated from the server — no fetching here.
//
// Colours come from the CSS custom properties in globals.css rather than hex
// literals, per CLAUDE.md ("never hardcode hex values in components").

export function TrendChart({
  data,
  metric,
  wall = false,
}: {
  data: TrendPoint[];
  metric: "dau" | "sessions";
  wall?: boolean;
}) {
  const stroke = metric === "dau" ? "var(--info)" : "var(--primary)";
  const gradientId = `grad-${metric}`;

  return (
    <ResponsiveContainer width="100%" height={wall ? 220 : 160}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: "var(--muted-foreground)", fontSize: wall ? 13 : 11 }}
          tickLine={false}
          axisLine={false}
          // "08-09" — the year is noise on a 28-day window.
          tickFormatter={(d: string) => d.slice(5)}
          minTickGap={wall ? 40 : 24}
        />
        <YAxis
          tick={{ fill: "var(--muted-foreground)", fontSize: wall ? 13 : 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            color: "var(--foreground)",
            fontSize: 13,
          }}
          labelStyle={{ color: "var(--muted-foreground)" }}
          cursor={{ stroke: "var(--border)" }}
        />
        <Area
          type="monotone"
          dataKey={metric}
          name={metric === "dau" ? "Daily active users" : "Sessions"}
          stroke={stroke}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          // No entry animation: the board re-renders on a 60s poll and a
          // replaying chart reads as a data change that didn't happen.
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
