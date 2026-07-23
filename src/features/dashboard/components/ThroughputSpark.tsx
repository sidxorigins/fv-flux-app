"use client";

// Compact throughput: headline number + a 48px sparkline. Replaces the
// full-size ThroughputArea on the dashboard — sparse data reads as a stat,
// not as a mostly-empty 200px chart canvas.

import * as React from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import type { ThroughputWeek } from "@/features/dashboard/queries";

export function ThroughputSpark({ data }: { data: ThroughputWeek[] }) {
  const thisWeek = data.length > 0 ? data[data.length - 1].completed : 0;
  const total = data.reduce((sum, d) => sum + d.completed, 0);
  const gradientId = React.useId();

  return (
    <div className="flex flex-col gap-2">
      <div>
        <span className="text-foreground text-2xl leading-none font-semibold tabular-nums">
          {thisWeek}
        </span>
        <span className="text-muted-foreground ml-1.5 text-xs">
          done this week
        </span>
      </div>
      {total === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing completed in the last 8 weeks.
        </p>
      ) : (
        <div
          role="img"
          aria-label={`Throughput sparkline: ${total} tasks completed over the last 8 weeks`}
          className="h-12"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="completed"
                stroke="var(--primary)"
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false}
                isAnimationActive
                animationDuration={300}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <span className="text-muted-foreground text-[11px]">last 8 weeks</span>
    </div>
  );
}
