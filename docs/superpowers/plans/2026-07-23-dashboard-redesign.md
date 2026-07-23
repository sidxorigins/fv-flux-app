# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompose `/dashboard` into the approved "focus hero + dense grid" design: hero band with inline KPIs, tightened work row with a merged Inbox/Activity tabbed panel, a compact 4-cell Pulse band replacing the oversized charts, and an auto-fit Projects rail — no dead zones at any data volume.

**Architecture:** Server Components throughout; client JS limited to existing charts, the status dropdowns, the entrance wrapper, and one new thin tab-toggle component. Data layer unchanged except (a) `getProjectTiles` gains per-status counts and (b) a new pure `dedupeActivity` function. Spec: `docs/superpowers/specs/2026-07-23-dashboard-redesign-design.md`.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, Tailwind CSS 4 tokens from `globals.css`, Recharts (existing), Vitest.

## Global Constraints

- Never hardcode hex colours — use tokens (`--primary`, `--surface`, functional colours) via Tailwind classes or `var(--…)`.
- Glass (`.glass`) on hero + top-level panels only; nested content uses solid `--surface` / `--surface-raised`.
- No new animation. Keep the single `DashboardEntrance` wrapper as-is.
- Preserve tour anchors exactly: `data-tour="dashboard-kpis"`, `data-tour="dashboard-mywork"`, `data-tour="create-task"`.
- Preserve the no-memberships empty state block in `page.tsx` unchanged.
- Greeting timezone is `Asia/Dubai` (org TZ), never raw server local time.
- TypeScript strict; named exports; no `any`.
- All commands run from repo root `/Users/sunjehraja/Downloads/flux-app`.

---

### Task 1: `dedupeActivity` pure function

**Files:**
- Create: `src/features/dashboard/dedupe-activity.ts`
- Test: `src/features/dashboard/dedupeActivity.test.ts`

**Interfaces:**
- Consumes: `DashboardActivity` from `src/features/dashboard/queries.ts` (existing).
- Produces: `type DedupedActivity = DashboardActivity & { count: number }` and `function dedupeActivity(items: DashboardActivity[]): DedupedActivity[]`. Task 6 (ActivityFeed edit) and Task 8 (page) rely on these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/dedupeActivity.test.ts
import { describe, expect, it } from "vitest";

import { dedupeActivity } from "./dedupe-activity";
import type { DashboardActivity } from "./queries";

function item(over: Partial<DashboardActivity> & { id: string }): DashboardActivity {
  return {
    action: "updated",
    field: "title",
    oldValue: null,
    newValue: null,
    createdAt: new Date("2026-07-20T10:00:00Z"),
    actor: { id: "u1", name: "Flux Admin", avatarUrl: null },
    task: { id: "t1", key: "FLUX-5", title: "Task", projectId: "p1", projectKey: "FLUX" },
    ...over,
  };
}

describe("dedupeActivity", () => {
  it("collapses consecutive same actor+action+field+task into one row with count", () => {
    const input = [
      item({ id: "a" }),
      item({ id: "b" }),
      item({ id: "c" }),
    ];
    const out = dedupeActivity(input);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a"); // keeps the first (most recent) row
    expect(out[0].count).toBe(3);
  });

  it("does not collapse across a different task or action", () => {
    const input = [
      item({ id: "a" }),
      item({ id: "b", task: { id: "t2", key: "FLUX-7", title: "Other", projectId: "p1", projectKey: "FLUX" } }),
      item({ id: "c" }),
    ];
    const out = dedupeActivity(input);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(out.every((i) => i.count === 1)).toBe(true);
  });

  it("does not collapse across different actors and preserves order", () => {
    const input = [
      item({ id: "a" }),
      item({ id: "b", actor: { id: "u2", name: "Sam", avatarUrl: null } }),
    ];
    const out = dedupeActivity(input);
    expect(out.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns [] for []", () => {
    expect(dedupeActivity([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/dedupeActivity.test.ts`
Expected: FAIL — cannot resolve `./dedupe-activity`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/dashboard/dedupe-activity.ts
// Pure helper (server- and client-safe — no "use client", no server imports):
// collapses CONSECUTIVE activity rows by the same actor doing the same thing to
// the same task into one row with a count, so "renamed FLUX-5" ×6 renders once.

import type { DashboardActivity } from "./queries";

export type DedupedActivity = DashboardActivity & { count: number };

function dedupeKey(a: DashboardActivity): string {
  return `${a.actor.id}|${a.action}|${a.field ?? ""}|${a.task.id}`;
}

/** Items arrive newest-first; the kept row is the newest of each run. */
export function dedupeActivity(items: DashboardActivity[]): DedupedActivity[] {
  const out: DedupedActivity[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (prev && dedupeKey(prev) === dedupeKey(item)) {
      prev.count += 1;
    } else {
      out.push({ ...item, count: 1 });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/dedupeActivity.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/dedupe-activity.ts src/features/dashboard/dedupeActivity.test.ts
git commit -m "feat(dashboard): dedupeActivity — collapse consecutive duplicate activity rows"
```

---

### Task 2: Greeting helper (Asia/Dubai time-of-day)

**Files:**
- Create: `src/features/dashboard/greeting.ts`
- Test: `src/features/dashboard/greeting.test.ts`

**Interfaces:**
- Produces: `function greetingFor(date: Date): "morning" | "afternoon" | "evening"` and `function dubaiDateLine(date: Date): string` (e.g. `"Wednesday, 23 July"`). Task 3 (HeroBand) relies on both.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/dashboard/greeting.test.ts
import { describe, expect, it } from "vitest";

import { dubaiDateLine, greetingFor } from "./greeting";

// Dubai is UTC+4 year-round. 2026-07-23T04:00Z = 08:00 in Dubai.
describe("greetingFor", () => {
  it("08:00 Dubai → morning", () => {
    expect(greetingFor(new Date("2026-07-23T04:00:00Z"))).toBe("morning");
  });
  it("13:00 Dubai → afternoon", () => {
    expect(greetingFor(new Date("2026-07-23T09:00:00Z"))).toBe("afternoon");
  });
  it("19:00 Dubai → evening", () => {
    expect(greetingFor(new Date("2026-07-23T15:00:00Z"))).toBe("evening");
  });
  it("03:00 Dubai (23:00Z prev day) → evening", () => {
    expect(greetingFor(new Date("2026-07-22T23:00:00Z"))).toBe("evening");
  });
  it("boundary 12:00 Dubai → afternoon", () => {
    expect(greetingFor(new Date("2026-07-23T08:00:00Z"))).toBe("afternoon");
  });
});

describe("dubaiDateLine", () => {
  it("formats weekday + day + month in Dubai time", () => {
    // 23:00Z on 22 Jul = 03:00 on 23 Jul in Dubai — date must be the 23rd.
    expect(dubaiDateLine(new Date("2026-07-22T23:00:00Z"))).toBe(
      "Thursday, 23 July",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/dashboard/greeting.test.ts`
Expected: FAIL — cannot resolve `./greeting`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/dashboard/greeting.ts
// Pure, deterministic helpers pinned to the org timezone (single-org app based
// in Dubai; the prod box runs UTC, so raw server-local time would mislabel the
// time of day). Spec: 05–12 morning, 12–17 afternoon, else evening.

const ORG_TZ = "Asia/Dubai";

function dubaiHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: ORG_TZ,
      hour: "numeric",
      hourCycle: "h23",
    }).format(date),
  );
}

export function greetingFor(date: Date): "morning" | "afternoon" | "evening" {
  const hour = dubaiHour(date);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

/** "Wednesday, 23 July" — the hero's date line, in org time. */
export function dubaiDateLine(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ORG_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/dashboard/greeting.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/greeting.ts src/features/dashboard/greeting.test.ts
git commit -m "feat(dashboard): greeting + date-line helpers pinned to Asia/Dubai"
```

---

### Task 3: `HeroBand` server component

**Files:**
- Create: `src/features/dashboard/components/HeroBand.tsx`

**Interfaces:**
- Consumes: `DashboardKpis` from `queries.ts`; `greetingFor`, `dubaiDateLine` from Task 2.
- Produces: `function HeroBand({ firstName, kpis, cta }: { firstName: string; kpis: DashboardKpis; cta?: React.ReactNode })` — server component. Task 8 (page) renders it with `cta={<span data-tour="create-task"><CreateTaskDialog …/></span>}`.

- [ ] **Step 1: Write the component**

```tsx
// src/features/dashboard/components/HeroBand.tsx
import { cn } from "@/lib/utils";
import type { DashboardKpis } from "@/features/dashboard/queries";
import { dubaiDateLine, greetingFor } from "@/features/dashboard/greeting";

/**
 * Dashboard hero: greeting + date + one-line summary on the left, the New-task
 * CTA on the right, and the four KPIs as inline stat blocks along the bottom —
 * hairline-divided, not four separate cards. Server component, zero JS.
 */
export function HeroBand({
  firstName,
  kpis,
  cta,
}: {
  firstName: string;
  kpis: DashboardKpis;
  cta?: React.ReactNode;
}) {
  const now = new Date();
  const completedDelta = kpis.completedThisWeek - kpis.completedLastWeek;

  const summary = [
    `${kpis.openAssigned} open`,
    kpis.overdue > 0 ? `${kpis.overdue} overdue` : null,
    kpis.dueSoon > 0 ? `${kpis.dueSoon} due soon` : null,
    kpis.inReview > 0 ? `${kpis.inReview} in review` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const stats: {
    label: string;
    value: number;
    sub: React.ReactNode;
    alarm?: boolean;
  }[] = [
    { label: "My open tasks", value: kpis.openAssigned, sub: "assigned to you" },
    {
      label: "Due soon",
      value: kpis.dueSoon,
      sub:
        kpis.overdue > 0 ? (
          <span className="text-danger font-medium">{kpis.overdue} overdue</span>
        ) : (
          "next 7 days"
        ),
      alarm: kpis.overdue > 0,
    },
    { label: "In review", value: kpis.inReview, sub: "awaiting review" },
    {
      label: "Completed this week",
      value: kpis.completedThisWeek,
      sub: (
        <span
          className={cn(
            "tabular-nums",
            completedDelta > 0 && "text-success",
          )}
        >
          {completedDelta > 0 ? `+${completedDelta}` : completedDelta} vs last
          week
        </span>
      ),
    },
  ];

  return (
    <section className="glass flex flex-col gap-6 p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">{dubaiDateLine(now)}</p>
          <h1 className="text-foreground mt-1 text-3xl font-semibold tracking-tight">
            Good {greetingFor(now)}, {firstName}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">{summary}</p>
        </div>
        {cta}
      </div>

      <div
        data-tour="dashboard-kpis"
        className="border-border grid grid-cols-2 gap-y-5 border-t pt-5 xl:grid-cols-4"
      >
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className={cn(
              "flex flex-col gap-1 px-4 first:pl-0",
              // hairline dividers between blocks (skip the row start)
              i > 0 && "border-border sm:border-l",
              i === 2 && "max-xl:border-l-0",
            )}
          >
            <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              {stat.label}
            </span>
            <span
              className={cn(
                "text-3xl leading-none font-semibold tracking-tight tabular-nums",
                stat.alarm ? "text-danger" : "text-foreground",
              )}
            >
              {stat.value}
            </span>
            <span className="text-muted-foreground text-[11px]">{stat.sub}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (component not yet imported anywhere).

- [ ] **Step 3: Commit**

```bash
git add src/features/dashboard/components/HeroBand.tsx
git commit -m "feat(dashboard): HeroBand — greeting hero with inline KPI stat blocks"
```

---

### Task 4: Compact Pulse visuals — `ThroughputSpark` + `WorkloadBars` + compact `StatusDonut`

**Files:**
- Create: `src/features/dashboard/components/ThroughputSpark.tsx`
- Create: `src/features/dashboard/components/WorkloadBars.tsx`
- Modify: `src/features/dashboard/components/Charts.tsx:103-180` (StatusDonut gains a `compact` prop)

**Interfaces:**
- Consumes: `ThroughputWeek[]`, `WorkloadEntry[]`, `StatusDistribution` from `queries.ts`.
- Produces: `function ThroughputSpark({ data }: { data: ThroughputWeek[] })` (client); `function WorkloadBars({ data }: { data: WorkloadEntry[] })` (server); `StatusDonut` accepts optional `compact?: boolean`. Task 8 uses all three.

- [ ] **Step 1: Write `ThroughputSpark`**

```tsx
// src/features/dashboard/components/ThroughputSpark.tsx
"use client";

// Compact throughput: headline number + a 48px sparkline. Replaces the
// full-size ThroughputArea on the dashboard — sparse data reads as a stat,
// not as a mostly-empty 200px chart canvas.

import { Area, AreaChart, ResponsiveContainer } from "recharts";

import type { ThroughputWeek } from "@/features/dashboard/queries";

export function ThroughputSpark({ data }: { data: ThroughputWeek[] }) {
  const thisWeek = data.length > 0 ? data[data.length - 1].completed : 0;
  const total = data.reduce((sum, d) => sum + d.completed, 0);

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
                <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="completed"
                stroke="var(--primary)"
                strokeWidth={1.5}
                fill="url(#spark-fill)"
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
```

- [ ] **Step 2: Write `WorkloadBars`**

```tsx
// src/features/dashboard/components/WorkloadBars.tsx
import type { WorkloadEntry } from "@/features/dashboard/queries";

const MAX_ROWS = 6;

/**
 * Compact workload list-bars: name, thin proportional bar, count. Server
 * component, zero JS — replaces the WorkloadBar chart canvas on the dashboard,
 * which rendered a near-empty 120px+ canvas for one or two assignees.
 */
export function WorkloadBars({ data }: { data: WorkloadEntry[] }) {
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">No open tasks assigned.</p>;
  }

  const shown = data.slice(0, MAX_ROWS);
  const hidden = data.length - shown.length;
  const max = Math.max(...shown.map((d) => d.openTasks));

  return (
    <ul className="flex flex-col gap-2">
      {shown.map((entry) => (
        <li key={entry.userId} className="flex items-center gap-2 text-sm">
          <span className="text-foreground w-24 shrink-0 truncate" title={entry.name}>
            {entry.name}
          </span>
          <span
            aria-hidden
            className="bg-surface-raised h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
          >
            <span
              className="bg-info block h-full rounded-full"
              style={{ width: `${(entry.openTasks / max) * 100}%` }}
            />
          </span>
          <span className="text-muted-foreground w-6 shrink-0 text-right text-xs tabular-nums">
            {entry.openTasks}
          </span>
        </li>
      ))}
      {hidden > 0 ? (
        <li className="text-muted-foreground text-xs">+{hidden} more</li>
      ) : null}
    </ul>
  );
}
```

- [ ] **Step 3: Add `compact` prop to `StatusDonut` in `Charts.tsx`**

Replace the `StatusDonut` function signature and the two size-bearing elements (keep everything else in the function identical):

```tsx
export function StatusDonut({
  data,
  compact = false,
}: {
  data: StatusDistribution;
  compact?: boolean;
}) {
```

Replace the donut wrapper div's className (line ~128, `className="relative h-[180px]"`):

```tsx
        className={compact ? "relative h-[120px]" : "relative h-[180px]"}
```

Replace the centre-total number span's className (line ~152):

```tsx
          <span
            className={
              compact
                ? "text-foreground text-lg leading-none font-semibold tabular-nums"
                : "text-foreground text-2xl leading-none font-semibold tabular-nums"
            }
          >
```

And the empty-state height div (line ~115, `className="h-[200px]"`):

```tsx
      <div className={compact ? "h-[120px]" : "h-[200px]"}>
```

- [ ] **Step 4: Type-check + run existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/components/ThroughputSpark.tsx src/features/dashboard/components/WorkloadBars.tsx src/features/dashboard/components/Charts.tsx
git commit -m "feat(dashboard): compact pulse visuals — sparkline, list-bars, compact donut"
```

---

### Task 5: `getProjectTiles` status counts + `ProjectTiles` auto-fit grid with progress bar

**Files:**
- Modify: `src/features/dashboard/queries.ts:388-446` (ProjectTile interface + getProjectTiles)
- Modify: `src/features/dashboard/components/ProjectTiles.tsx` (full rewrite of grid + tile)

**Interfaces:**
- Produces: `ProjectTile` gains `statusCounts: { todo: number; inProgress: number; inReview: number; done: number }`. `ProjectTiles` renders an auto-fit rail. Task 8 renders `<ProjectTiles tiles={tiles} />` unchanged.

- [ ] **Step 1: Extend the query**

In `src/features/dashboard/queries.ts`, replace the `ProjectTile` interface:

```ts
export interface ProjectTile {
  id: string;
  key: string;
  name: string;
  role: ProjectRole;
  openTaskCount: number;
  /** Per-status counts for the tile's thin progress bar. */
  statusCounts: { todo: number; inProgress: number; inReview: number; done: number };
}
```

Replace the whole `getProjectTiles` function body with:

```ts
export async function getProjectTiles(
  scope?: DashboardScope,
): Promise<ProjectTile[]> {
  const s = scope ?? (await getDashboardScope());

  const tileSelect = { id: true, key: true, name: true };

  // Resolve the visible projects (+ per-user role) first…
  let base: { id: string; key: string; name: string; role: ProjectRole }[];
  if (s.isAdmin) {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: tileSelect,
    });
    // admin effective role (bypass policy, matches getMyProjects)
    base = projects.map((p) => ({ ...p, role: "MANAGER" as const }));
  } else {
    const memberships = await prisma.projectMembership.findMany({
      where: { userId: s.userId },
      orderBy: { project: { createdAt: "desc" } },
      select: { projectRole: true, project: { select: tileSelect } },
    });
    base = memberships.map(({ projectRole, project }) => ({
      ...project,
      role: projectRole,
    }));
  }
  if (base.length === 0) return [];

  // …then ONE grouped count over all of them (no per-task rows).
  const grouped = await prisma.task.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: base.map((p) => p.id) } },
    _count: { _all: true },
  });
  const countFor = (projectId: string, status: TaskStatus): number =>
    grouped.find((g) => g.projectId === projectId && g.status === status)
      ?._count._all ?? 0;

  return base.map((p) => {
    const statusCounts = {
      todo: countFor(p.id, "TODO"),
      inProgress: countFor(p.id, "IN_PROGRESS"),
      inReview: countFor(p.id, "IN_REVIEW"),
      done: countFor(p.id, "DONE"),
    };
    return {
      ...p,
      openTaskCount:
        statusCounts.todo + statusCounts.inProgress + statusCounts.inReview,
      statusCounts,
    };
  });
}
```

- [ ] **Step 2: Rewrite `ProjectTiles.tsx`**

```tsx
// src/features/dashboard/components/ProjectTiles.tsx
import Link from "next/link";

import type { ProjectRole } from "@/generated/prisma/enums";
import type { ProjectTile } from "@/features/dashboard/queries";
import { projectPath } from "@/features/tasks/share";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<ProjectRole, string> = {
  MANAGER: "Manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

/** Segment order + functional colours for the thin status bar. */
const SEGMENTS = [
  { key: "done", className: "bg-success" },
  { key: "inReview", className: "bg-warning" },
  { key: "inProgress", className: "bg-info" },
  { key: "todo", className: "bg-surface-raised" },
] as const;

/**
 * Project shortcuts rail. auto-fit + capped tile width: one tile doesn't
 * strand a mostly-empty 4-column row, many tiles wrap naturally. Solid
 * surface (glass is reserved for panel chrome); CSS-only hover raise.
 */
export function ProjectTiles({ tiles }: { tiles: ProjectTile[] }) {
  if (tiles.length === 0) return null;

  return (
    <ul className="grid justify-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,300px))]">
      {tiles.map((tile) => {
        const total =
          tile.statusCounts.todo +
          tile.statusCounts.inProgress +
          tile.statusCounts.inReview +
          tile.statusCounts.done;
        return (
          <li key={tile.id}>
            <Link
              href={projectPath(tile.key)}
              className={cn(
                "group border-border bg-surface flex h-full flex-col gap-3 rounded-2xl border p-4",
                "transition-[transform,background-color] duration-150 motion-reduce:transition-none",
                "hover:bg-surface-raised hover:-translate-y-px motion-reduce:hover:translate-y-0",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-xs font-medium">
                  {tile.key}
                </span>
                <span className="text-muted-foreground ml-auto text-[11px]">
                  {ROLE_LABEL[tile.role]}
                </span>
              </div>
              <p className="text-foreground truncate text-sm font-medium">
                {tile.name}
              </p>
              {total > 0 ? (
                <div
                  aria-hidden
                  className="flex h-1 w-full overflow-hidden rounded-full"
                >
                  {SEGMENTS.map(({ key, className }) =>
                    tile.statusCounts[key] > 0 ? (
                      <span
                        key={key}
                        className={className}
                        style={{ width: `${(tile.statusCounts[key] / total) * 100}%` }}
                      />
                    ) : null,
                  )}
                </div>
              ) : null}
              <p className="text-muted-foreground mt-auto text-xs">
                <span className="text-foreground font-semibold tabular-nums">
                  {tile.openTaskCount}
                </span>{" "}
                open {tile.openTaskCount === 1 ? "task" : "tasks"}
                {tile.statusCounts.done > 0 ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {tile.statusCounts.done} done
                  </span>
                ) : null}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: Type-check + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean. (`getProjectTiles` is DB-backed — verified visually in Task 9.)

- [ ] **Step 4: Commit**

```bash
git add src/features/dashboard/queries.ts src/features/dashboard/components/ProjectTiles.tsx
git commit -m "feat(dashboard): project tiles — status counts, progress bar, auto-fit rail"
```

---

### Task 6: `InboxActivityTabs` + ActivityFeed `×N` support

**Files:**
- Create: `src/features/dashboard/components/InboxActivityTabs.tsx`
- Modify: `src/features/dashboard/components/ActivityFeed.tsx` (accept `DedupedActivity[]`, render `×N`)

**Interfaces:**
- Consumes: `DedupedActivity` from Task 1.
- Produces: `function InboxActivityTabs({ unreadCount, inbox, activity }: { unreadCount: number; inbox: React.ReactNode; activity: React.ReactNode })` — thin client component; server-rendered children passed in. `ActivityFeed({ items: DedupedActivity[] })`. Task 8 uses both.

- [ ] **Step 1: Write `InboxActivityTabs`**

```tsx
// src/features/dashboard/components/InboxActivityTabs.tsx
"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Merged Inbox / Activity panel — one glass panel, two tabs. The ONLY client
 * state is which tab is visible; both children are server-rendered and passed
 * in, then toggled with `hidden` (no refetch, no remount).
 * Default tab: Inbox when there are unread notifications, else Activity.
 */
export function InboxActivityTabs({
  unreadCount,
  inbox,
  activity,
}: {
  unreadCount: number;
  inbox: React.ReactNode;
  activity: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<"inbox" | "activity">(
    unreadCount > 0 ? "inbox" : "activity",
  );

  const tabButton = (key: "inbox" | "activity", label: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium tracking-wide uppercase",
        "transition-colors duration-150 motion-reduce:transition-none",
        "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
        tab === key
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Inbox and activity" className="flex gap-1">
        {tabButton(
          "inbox",
          <>
            Inbox
            {unreadCount > 0 ? (
              <span className="bg-primary/12 text-primary ml-1.5 rounded-full px-1.5 tabular-nums">
                {unreadCount}
              </span>
            ) : null}
          </>,
        )}
        {tabButton("activity", "Activity")}
      </div>
      <div role="tabpanel" hidden={tab !== "inbox"}>
        {inbox}
      </div>
      <div role="tabpanel" hidden={tab !== "activity"}>
        {activity}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `ActivityFeed`**

In `src/features/dashboard/components/ActivityFeed.tsx`:

Replace the import of `DashboardActivity`:

```tsx
import type { DedupedActivity } from "@/features/dashboard/dedupe-activity";
```

Replace `describe(item: DashboardActivity)` parameter type with `DedupedActivity`, and the component signature:

```tsx
export function ActivityFeed({ items }: { items: DedupedActivity[] }) {
```

Replace the empty state `<p>` (slim row per spec):

```tsx
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-2 text-sm">No recent activity.</p>
    );
  }
```

Add the `×N` chip: inside the sentence `<p>`, immediately after `{tail ?? ""}` insert:

```tsx
              {item.count > 1 ? (
                <span className="bg-surface-raised text-muted-foreground ml-1.5 rounded px-1 text-[11px] tabular-nums">
                  ×{item.count}
                </span>
              ) : null}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: ONE expected error in `src/app/(dashboard)/dashboard/page.tsx` (ActivityFeed now wants `DedupedActivity[]`) — fixed in Task 8. No other errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/dashboard/components/InboxActivityTabs.tsx src/features/dashboard/components/ActivityFeed.tsx
git commit -m "feat(dashboard): tabbed inbox/activity panel + deduped activity rendering"
```

---

### Task 7: Slim inbox empty state

**Files:**
- Modify: `src/features/dashboard/components/InboxPanel.tsx:47-53`

**Interfaces:** unchanged (`InboxPanel({ notifications })`).

- [ ] **Step 1: Replace the tall empty state**

Replace:

```tsx
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        You&apos;re all caught up.
      </p>
    );
  }
```

with:

```tsx
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 py-2 text-sm">
        <span aria-hidden className="text-success">✓</span>
        You&apos;re all caught up.
      </p>
    );
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/features/dashboard/components/InboxPanel.tsx
git commit -m "fix(dashboard): inbox empty state collapses to a slim row"
```

---

### Task 8: Page recomposition

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx` (full rewrite below)

**Interfaces:**
- Consumes: everything produced by Tasks 1–7. Uses `requireUser` result via `getDashboardScope` — first name comes from a new narrow select (see code).

- [ ] **Step 1: Rewrite `page.tsx`**

```tsx
// src/app/(dashboard)/dashboard/page.tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { prisma } from "@/lib/db";
import { getCreatableProjects } from "@/features/projects/queries";
import {
  getDashboardScope,
  getKpis,
  getMyWorkGrouped,
  getProjectTiles,
  getRecentActivity,
  getStatusDistribution,
  getThroughput,
  getWorkload,
} from "@/features/dashboard/queries";
import { dedupeActivity } from "@/features/dashboard/dedupe-activity";
import { getNotificationsPage } from "@/features/notifications/queries";
import { getMyLoggedHours } from "@/features/time/queries";
import { MyLoggedHours } from "@/features/time/components/MyLoggedHours";
import { StatusDonut } from "@/features/dashboard/components/Charts";
import { ThroughputSpark } from "@/features/dashboard/components/ThroughputSpark";
import { WorkloadBars } from "@/features/dashboard/components/WorkloadBars";
import { HeroBand } from "@/features/dashboard/components/HeroBand";
import { GroupedWorkList } from "@/features/dashboard/components/GroupedWorkList";
import { InboxPanel } from "@/features/dashboard/components/InboxPanel";
import { InboxActivityTabs } from "@/features/dashboard/components/InboxActivityTabs";
import { ActivityFeed } from "@/features/dashboard/components/ActivityFeed";
import { ProjectTiles } from "@/features/dashboard/components/ProjectTiles";
import { DashboardEntrance } from "@/features/dashboard/components/DashboardEntrance";
import { CreateTaskDialog } from "@/features/tasks/components";
import { GuidedTour } from "@/features/onboarding/components/GuidedTour";
import { dashboardTourSteps } from "@/features/onboarding/steps";
import { getTourState } from "@/features/onboarding/queries";
import { cn } from "@/lib/utils";

/** Small-caps muted section heading — the one heading style across the grid. */
function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-muted-foreground text-xs font-medium tracking-wider uppercase",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** "You" (personal) vs "Team" (project-wide) chip — clarifies each widget's scope. */
function ScopeChip({ scope }: { scope: "you" | "team" }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
        scope === "you"
          ? "bg-primary/12 text-primary"
          : "bg-surface-raised text-muted-foreground",
      )}
    >
      {scope === "you" ? "You" : "Team"}
    </span>
  );
}

/** Glass panel — the dashboard-card chrome. */
function Panel({
  title,
  scope,
  action,
  children,
  className,
}: {
  title?: string;
  scope?: "you" | "team";
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass flex flex-col gap-3 p-5", className)}>
      {title ? (
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2">
            <SectionHeading>{title}</SectionHeading>
            {scope ? <ScopeChip scope={scope} /> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Cell header inside the Pulse band (no glass — the band is the panel). */
function PulseCell({
  title,
  scope,
  children,
}: {
  title: string;
  scope: "you" | "team";
  children: React.ReactNode;
}) {
  return (
    <div className="border-border flex min-w-0 flex-col gap-3 p-5 sm:not-first:border-l max-sm:not-first:border-t">
      <div className="flex items-center gap-2">
        <SectionHeading>{title}</SectionHeading>
        <ScopeChip scope={scope} />
      </div>
      {children}
    </div>
  );
}

/**
 * The flagship screen — "focus hero + dense grid". Everything fetched
 * server-side in one Promise.all; scope resolves once. Client JS on the page:
 * chart components, the tab toggle, inline status dropdowns, entrance wrapper.
 */
export default async function DashboardPage() {
  const scope = await getDashboardScope();
  const tour = await getTourState();

  // No memberships → the CLAUDE.md onboarding empty state, no dead widgets.
  if (scope.projectIds.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <div className="glass mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-2 px-8 py-12 text-center">
          <p className="text-foreground text-base font-medium">
            You don&apos;t have access to any projects yet
          </p>
          <p className="text-muted-foreground text-sm">
            An admin will add you. Once you&apos;re in a project, your work,
            activity and charts appear here.
          </p>
        </div>
        <GuidedTour
          steps={dashboardTourSteps(scope.isAdmin)}
          autoStart={!tour.completed}
        />
      </div>
    );
  }

  const [
    me,
    kpis,
    statusDist,
    throughput,
    workload,
    activity,
    tiles,
    work,
    inbox,
    creatable,
    loggedHours,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: scope.userId },
      select: { name: true, username: true },
    }),
    getKpis(scope),
    getStatusDistribution(scope),
    getThroughput(scope),
    getWorkload(scope),
    getRecentActivity(20, scope),
    getProjectTiles(scope),
    getMyWorkGrouped(),
    getNotificationsPage({ unreadOnly: true, limit: 5 }),
    getCreatableProjects(),
    getMyLoggedHours(),
  ]);

  const firstName = (me.name.trim().split(/\s+/)[0] || me.username) ?? "there";
  const deduped = dedupeActivity(activity);

  const viewAll = (href: string, label = "View all") => (
    <Link
      href={href}
      className="text-primary hover:text-primary-hover focus-visible:ring-ring/50 flex items-center gap-1 rounded text-xs font-medium outline-none focus-visible:ring-2"
    >
      {label}
      <ArrowRight aria-hidden className="size-3" />
    </Link>
  );

  return (
    <DashboardEntrance>
      <div className="flex flex-col gap-4">
        {/* Hero — greeting, date, summary, CTA, inline KPIs */}
        <HeroBand
          firstName={firstName}
          kpis={kpis}
          cta={
            creatable.length > 0 ? (
              <span data-tour="create-task">
                <CreateTaskDialog projects={creatable} />
              </span>
            ) : undefined
          }
        />

        {/* Work row — agenda 2/3, merged inbox/activity 1/3 */}
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div data-tour="dashboard-mywork" className="min-w-0 lg:col-span-2">
            <Panel title="My work" scope="you" action={viewAll("/tasks")}>
              <GroupedWorkList work={work} />
            </Panel>
          </div>

          <Panel className="min-w-0" title="Updates" scope="you" action={viewAll("/inbox")}>
            <InboxActivityTabs
              unreadCount={inbox.items.length}
              inbox={<InboxPanel notifications={inbox.items} />}
              activity={<ActivityFeed items={deduped} />}
            />
          </Panel>
        </div>

        {/* Projects rail */}
        {tiles.length > 0 ? (
          <section className="flex flex-col gap-3">
            <SectionHeading>Projects</SectionHeading>
            <ProjectTiles tiles={tiles} />
          </section>
        ) : null}

        {/* Pulse band — compact, data-aware team/personal vitals */}
        <section className="glass grid p-0 sm:grid-cols-2 xl:grid-cols-4">
          <PulseCell title="Status" scope="team">
            <StatusDonut data={statusDist} compact />
          </PulseCell>
          <PulseCell title="Throughput" scope="team">
            <ThroughputSpark data={throughput} />
          </PulseCell>
          <PulseCell title="Workload" scope="team">
            <WorkloadBars data={workload} />
          </PulseCell>
          <PulseCell title="My hours" scope="you">
            <MyLoggedHours data={loggedHours} />
          </PulseCell>
        </section>
      </div>

      <GuidedTour
        steps={dashboardTourSteps(scope.isAdmin)}
        autoStart={!tour.completed}
      />
    </DashboardEntrance>
  );
}
```

Note: `sm:not-first:border-l max-sm:not-first:border-t` uses Tailwind 4 `not-first` variant; if the installed Tailwind version rejects it, use `sm:[&:not(:first-child)]:border-l max-sm:[&:not(:first-child)]:border-t` instead.

- [ ] **Step 2: Type-check + full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean — the Task 6 page error is now resolved.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors (warnings acceptable if pre-existing).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/page.tsx
git commit -m "feat(dashboard): recompose page — hero, dense work row, projects rail, pulse band"
```

---

### Task 9: Visual verification + polish pass

**Files:** none new — screenshots + fixes to any Task 3–8 file if issues found.

- [ ] **Step 1: Run the dev server and screenshot**

Dev server: `npm run dev` (needs local Postgres `flux_dev` running). Log in at `http://localhost:3000/login` as `it@iccadubai.ae` / `flux-local-Admin1!` (local seed only). Screenshot `/dashboard` at 1440×900 (viewport + full page) and 375×812 via chrome-devtools MCP.

- [ ] **Step 2: Check against success criteria**

- No empty band below any panel at 1440×900 with seed data.
- All previous data points visible (KPIs, work, inbox, activity, status, throughput, workload, hours, projects).
- Projects rail above the fold; hero renders greeting + date; activity shows `×N` chips; workload is list-bars; charts compact.
- Tour still anchors: open a private window, complete login, verify tour steps 6–8 point at hero KPIs, My work, New task.
- `prefers-reduced-motion`: entrance skipped (existing behaviour).

- [ ] **Step 3: Fix anything visibly off, re-screenshot, commit fixes**

```bash
git add -A src/
git commit -m "fix(dashboard): visual polish from screenshot review"
```

Only commit if fixes were needed.

- [ ] **Step 4: Production build gate**

Run: `npm run build`
Expected: build succeeds.

---

## Self-Review (done at plan time)

- **Spec coverage:** Hero (T3+T8), tabs+dedupe (T1+T6+T8), pulse compacts (T4+T8), projects rail (T5+T8), slim empty states (T6+T7), greeting TZ (T2), tour anchors (T3 `data-tour="dashboard-kpis"`, T8 `create-task` + `dashboard-mywork`), no-membership state preserved (T8), testing (T1, T2, T9). Success criteria (T9). ✔
- **Placeholders:** none — every step has full code or exact commands. ✔
- **Type consistency:** `DedupedActivity` (T1) consumed by T6/T8; `ProjectTile.statusCounts` shape identical in T5 query + component; `HeroBand` props match T8 usage; `StatusDonut compact` prop matches T8. `getRecentActivity(20, scope)` — limit raised from 12 to 20 because dedupe shrinks the list. ✔
