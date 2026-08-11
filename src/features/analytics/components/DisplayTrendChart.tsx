"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

// Wall-board trend: web vs app on one axis. Client-only because Recharts needs
// the DOM; data arrives pre-shaped from the server.
//
// No tooltip and no animation — nobody hovers a television, and replayed motion
// on a polling board reads as a data change that didn't happen.

export function DisplayTrendChart({
  data,
}: {
  data: { date: string; web: number; app: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="wallWeb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--info)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="wallApp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: "var(--muted-foreground)", fontSize: 14 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => d.slice(5)}
          minTickGap={48}
        />
        <YAxis
          tick={{ fill: "var(--muted-foreground)", fontSize: 14 }}
          tickLine={false}
          axisLine={false}
          width={46}
          allowDecimals={false}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={22}
          wrapperStyle={{ fontSize: 14, color: "var(--muted-foreground)" }}
        />
        <Area
          type="monotone"
          dataKey="web"
          name="Website"
          stroke="var(--info)"
          strokeWidth={2.5}
          fill="url(#wallWeb)"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="app"
          name="App"
          stroke="var(--primary)"
          strokeWidth={2.5}
          fill="url(#wallApp)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
