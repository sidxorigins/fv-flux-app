"use client";

// Dashboard charts — recharts, themed exclusively through CSS variables so the
// tokens in globals.css stay the single source of colour. Animations are
// recharts defaults capped at 300ms (transform/opacity-level SVG work, runs
// after data is already rendered server-side into the panel shell); none of it
// gates interactivity.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { TaskStatus } from "@/generated/prisma/enums";
// Deep import (not the barrel) so the board + dnd-kit never enter this bundle.
import { STATUS_META } from "@/features/tasks/components/StatusBadge";
import type {
  StatusDistribution,
  ThroughputWeek,
  WorkloadEntry,
} from "@/features/dashboard/queries";

const ANIMATION_MS = 300;

// Status → CSS variable (functional colours; chart tokens map to the same
// palette — TODO is the muted grey so the board's colour language carries over).
const STATUS_VAR: Record<TaskStatus, string> = {
  TODO: "var(--muted-foreground)",
  IN_PROGRESS: "var(--info)",
  IN_REVIEW: "var(--warning)",
  DONE: "var(--success)",
};

const AXIS_TICK = {
  fill: "var(--muted-foreground)",
  fontSize: 11,
} as const;

function NoData() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      No data yet
    </div>
  );
}

// Shared tooltip — surface-raised panel with a hairline border, per spec.
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
      {label !== undefined && label !== "" ? (
        <p className="text-muted-foreground mb-0.5 text-[11px]">{label}</p>
      ) : null}
      {payload.map((entry, i) => (
        <p
          key={i}
          className="text-foreground flex items-center gap-1.5 text-xs"
        >
          {entry.color ? (
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: entry.color }}
            />
          ) : null}
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="font-medium tabular-nums">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status donut
// ─────────────────────────────────────────────────────────────────────────────

export function StatusDonut({ data }: { data: StatusDistribution }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const slices = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      name: STATUS_META[d.status].label,
      value: d.count,
      color: STATUS_VAR[d.status],
    }));

  if (total === 0) {
    return (
      <div className="h-[200px]">
        <NoData />
      </div>
    );
  }

  return (
    <div>
      <div
        role="img"
        aria-label={`Status distribution donut chart: ${data
          .map((d) => `${STATUS_META[d.status].label} ${d.count}`)
          .join(", ")}`}
        className="relative h-[180px]"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="68%"
              outerRadius="92%"
              paddingAngle={slices.length > 1 ? 2 : 0}
              strokeWidth={0}
              isAnimationActive
              animationDuration={ANIMATION_MS}
            >
              {slices.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={<PanelTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Centre total — plain DOM so it's readable before any SVG animates */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-foreground text-2xl leading-none font-semibold tabular-nums">
            {total}
          </span>
          <span className="text-muted-foreground mt-1 text-[11px]">tasks</span>
        </div>
      </div>

      {/* Compact legend */}
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {data.map((d) => (
          <li
            key={d.status}
            className="text-muted-foreground flex items-center gap-1.5 text-xs"
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: STATUS_VAR[d.status] }}
            />
            <span className="truncate">{STATUS_META[d.status].label}</span>
            <span className="text-foreground ml-auto font-medium tabular-nums">
              {d.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Throughput area
// ─────────────────────────────────────────────────────────────────────────────

export function ThroughputArea({ data }: { data: ThroughputWeek[] }) {
  const total = data.reduce((sum, d) => sum + d.completed, 0);

  return (
    <div
      role="img"
      aria-label={
        total === 0
          ? "Throughput chart: no tasks completed in the last 8 weeks"
          : `Throughput chart: ${total} tasks completed over the last 8 weeks`
      }
      className="h-[200px]"
    >
      {total === 0 ? (
        <NoData />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
          >
            <defs>
              <linearGradient id="throughput-fill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--primary)"
                  stopOpacity={0.28}
                />
                <stop
                  offset="100%"
                  stopColor="var(--primary)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={40}
            />
            <Tooltip content={<PanelTooltip />} />
            <Area
              type="monotone"
              dataKey="completed"
              name="Completed"
              stroke="var(--primary)"
              strokeWidth={2}
              fill="url(#throughput-fill)"
              dot={false}
              activeDot={{ r: 3, fill: "var(--primary)", strokeWidth: 0 }}
              isAnimationActive
              animationDuration={ANIMATION_MS}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Workload bars
// ─────────────────────────────────────────────────────────────────────────────

const WORKLOAD_ROW_PX = 32;

export function WorkloadBar({ data }: { data: WorkloadEntry[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[120px]">
        <NoData />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={`Workload chart, open tasks by assignee: ${data
        .map((d) => `${d.name} ${d.openTasks}`)
        .join(", ")}`}
      style={{ height: data.length * WORKLOAD_ROW_PX + 16 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 32, bottom: 4, left: 0 }}
          barCategoryGap="28%"
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={104}
          />
          <Tooltip
            content={<PanelTooltip />}
            cursor={{ fill: "var(--glass-bg)" }}
          />
          <Bar
            dataKey="openTasks"
            name="Open tasks"
            fill="var(--info)"
            radius={[3, 3, 3, 3]}
            isAnimationActive
            animationDuration={ANIMATION_MS}
          >
            <LabelList
              dataKey="openTasks"
              position="right"
              className="tabular-nums"
              fill="var(--foreground)"
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
