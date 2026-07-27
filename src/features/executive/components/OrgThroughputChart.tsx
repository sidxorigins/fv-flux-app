"use client";

// Created vs completed per week — "is the org keeping up with what it takes
// on?". Themed exclusively through CSS variables so globals.css stays the
// single source of colour.

import * as React from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { OrgThroughputWeek } from "../queries";

const ANIMATION_MS = 300;
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
}

function PanelTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border-border bg-surface-raised rounded-lg border px-2.5 py-1.5 shadow-lg shadow-black/30">
      <p className="text-muted-foreground mb-0.5 text-[11px]">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-foreground text-xs" style={{ color: entry.color }}>
          {entry.name}: <span className="tabular-nums">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export function OrgThroughputChart({ data }: { data: OrgThroughputWeek[] }) {
  const createdId = React.useId();
  const completedId = React.useId();
  const total = data.reduce((sum, d) => sum + d.created + d.completed, 0);

  if (total === 0) {
    return (
      <div className="text-muted-foreground flex h-48 items-center justify-center text-sm">
        No activity in the last 8 weeks
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Tasks created versus completed per week over the last 8 weeks"
      className="h-48"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id={createdId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--info)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={completedId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--success)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<PanelTooltip />} cursor={{ stroke: "var(--border)" }} />
          <Area
            type="monotone"
            dataKey="created"
            name="Created"
            stroke="var(--info)"
            strokeWidth={1.5}
            fill={`url(#${createdId})`}
            dot={false}
            animationDuration={ANIMATION_MS}
          />
          <Area
            type="monotone"
            dataKey="completed"
            name="Completed"
            stroke="var(--success)"
            strokeWidth={1.5}
            fill={`url(#${completedId})`}
            dot={false}
            animationDuration={ANIMATION_MS}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
