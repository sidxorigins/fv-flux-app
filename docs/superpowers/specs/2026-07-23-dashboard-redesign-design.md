# Dashboard Redesign — "Focus hero + dense grid"

**Date:** 2026-07-23
**Status:** Approved
**Scope:** `/dashboard` only. Full visual/IA redesign; zero data-layer changes except an activity-dedupe pure function. All existing data stays on the dashboard.

## Problem

Screenshot audit (1440×900, seeded data) showed the current dashboard reads as mostly empty:

1. **Column imbalance** — left column (My work + 2 charts) ends ~400px before the right column (Recent activity), leaving a dead zone below the Workload panel.
2. **Charts are boxes of nothing** — Throughput renders a ~300px area chart for one small bump; Workload renders a near-empty canvas for a single assignee. Fixed-height charts + sparse data = emptiness.
3. **Empty states waste their footprint** — Inbox ("You're all caught up") and My logged hours ("0m") each occupy tall glass panels for one line of text.
4. **Projects section** — one tile stranded in a 4-column row, below the fold.
5. **Activity noise** — 12 near-identical "renamed FLUX-5" rows inflate the right column.

Root cause: a rigid grid that does not adapt to data volume. The fix is systemic: **empty or sparse content collapses to compact treatments; the layout composes at every data volume.**

## Design

### 1. Hero band (replaces the `h1` row + 4 KpiCard boxes)

Full-width glass panel; the existing orange radial glow in `globals.css` is concentrated behind it.

- Left: `Good {morning|afternoon|evening}, {firstName}` (Outfit, ~text-3xl), date line, and a one-sentence summary ("5 open · 1 overdue · 1 in review").
- Right: the existing `CreateTaskDialog` CTA (keeps `data-tour="create-task"` anchor).
- Bottom: the 4 KPIs (my open, due soon, in review, completed this week + delta) as **inline stat blocks** separated by hairline `--border` dividers inside the hero — not 4 separate cards. Keeps `data-tour="dashboard-kpis"` anchor.
- First name derives from the session user's `name` (first word); fall back to username.
- Time-of-day greeting is computed server-side in the org timezone `Asia/Dubai` (single-org app; prod box runs UTC — do NOT use raw server local time). Boundaries: 05–12 morning, 12–17 afternoon, else evening.

### 2. Work row — 2/3 + 1/3

- **My work** (left, `lg:col-span-2`): unchanged `GroupedWorkList` agenda; row height tightened to ~44px; keeps `data-tour="dashboard-mywork"` and the inline status dropdown (client).
- **Inbox ⧉ Activity** (right): one tabbed glass panel replacing the two separate panels.
  - Tabs: `Inbox (n)` and `Activity`. Default tab = Inbox when unread > 0, else Activity. Client component (tab state only); content server-rendered for both tabs and toggled client-side.
  - Inbox empty state = one slim row ("You're all caught up" + check icon), not a tall panel.
  - **Activity dedupe:** consecutive entries with same actor + same action + same task collapse into one row with a `×N` count. Pure function `dedupeActivity(items)` in `src/features/dashboard/` with unit tests. Query unchanged.

### 3. Pulse band (replaces the Throughput + Workload full-size panels and the right-column Status/Hours panels)

One full-width glass strip, 4 cells (`grid sm:grid-cols-2 xl:grid-cols-4`, internal hairline dividers):

- **Status** — compact donut (~120px) + inline legend (reuses `StatusDonut` sized down).
- **Throughput** — headline number ("N done this week") + small area sparkline (~48px tall) of the weekly series. Recharts, reusing existing data.
- **Workload** — compact horizontal list-bars: name, thin bar scaled to max, count. No chart canvas. Works at 1 assignee and at 10 (cap at top 6 + "+N more").
- **My hours** — compact stat ("0m logged this week") + tiny per-day bars when data exists; zero state = single line.

### 4. Projects rail

- Moves above the fold, directly under the work row.
- Grid: `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))` with a max-width cap per tile so 1 tile doesn't strand a mostly-empty row.
- Tile upgrade: key chip + role (existing), name, open count, plus a thin **status progress bar** (done/total segments in functional colours). Requires per-project status counts — extend `getProjectTiles` aggregate (grouped count, no per-task loading).

### 5. Craft rules (system-wide, this page)

- **Empty state = collapse to a slim row.** Never a tall empty panel.
- **Charts are data-aware:** sparse data gets compact treatment; nothing renders a large empty canvas.
- Glass on hero + panels only; nested content uses solid `--surface`. Orange = accents/CTA only. Functional colours for status/priority unchanged.
- Motion: keep the single `DashboardEntrance` fade/rise (after paint, respects `prefers-reduced-motion`). No stagger, no count-ups, no new animation.
- Server Components throughout; client JS limited to: charts, tab toggle, status dropdowns, entrance wrapper (unchanged surface area + one small tab component).
- Queries: unchanged except (a) `getProjectTiles` gains status counts, (b) `dedupeActivity` pure function. No schema changes, no migrations.
- Onboarding tour anchors preserved: `dashboard-kpis`, `dashboard-mywork`, `create-task`. Tour step positions re-verified after layout change.
- Empty-membership onboarding state (no projects) unchanged.

## Components

| Unit | Kind | Responsibility |
|---|---|---|
| `HeroBand` | server | greeting, date, summary sentence, CTA slot, inline KPI stats |
| `InboxActivityTabs` | client (thin) | tab state; renders server-passed children |
| `PulseBand` | server + existing chart clients | 4-cell compact strip |
| `WorkloadBars` | server | list-bars (replaces WorkloadBar canvas on dashboard) |
| `ThroughputSpark` | client (Recharts) | number + sparkline |
| `ProjectTiles` | server (edit) | auto-fit grid + progress bar |
| `dedupeActivity` | pure fn + tests | collapse consecutive duplicates |

Deleted from the page (not from the codebase if used elsewhere): full-size `ThroughputArea`/`WorkloadBar` panels, separate `KpiCard` grid, separate Inbox/Activity/Hours/Status panels.

## Error handling / edge cases

- 0 unread + 0 activity → tabs panel collapses to a slim "No recent activity" row.
- 1 project / many projects → auto-fit rail composes either way.
- Long names/titles truncate (`truncate` on one line) — no reflow.
- All queries already permission-scoped via `getDashboardScope`; no authz changes.

## Testing

- Unit: `dedupeActivity` (collapse runs, preserve order, ×N counts); `getProjectTiles` status-count shape.
- Existing `bucketWork` tests untouched.
- Visual: screenshot at 1440×900 and 375×812 after implementation; verify no dead zones with seeded data and with an empty-ish account.
- e2e smoke: dashboard renders, tour anchors present.

## Success criteria

- No empty band below any panel at 1440×900 with seed data.
- All current data points still present on the page.
- ~35% less vertical height; projects visible without scrolling.
- Lighthouse/perf unchanged or better (less chart canvas work).
