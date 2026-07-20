# Design — Guided Onboarding Tour

Date: 2026-07-20
Branch: `feat/onboarding-tour`

A custom, on-brand guided spotlight tour that walks a new user through Flux on
first login, replayable anytime. No new dependency.

---

## Locked decisions
- **Guided spotlight tour** (not just tooltips): dims the screen, spotlights one
  element at a time, shows a glass popover explaining it, Back / Next / Skip.
- **Custom**, themed to the design system (glass, tokens, Outfit) — built on the
  existing `ui/popover` + an overlay. No `driver.js`/`shepherd` dependency.
- **Persistence: a User DB field** `tourCompletedAt DateTime?` (one migration).
  Auto-shows once per user (across devices); a server action marks it done.
- **Scope: a single dashboard-anchored overview tour** (robust, single-page):
  the sidebar nav + key dashboard areas.

## Non-goals (v1)
- Multi-page / per-surface mini-tours (board, task drawer, backlog filters).
- Persistent "?" help tooltips on individual controls.
- Role/feature-flag-driven tour variants beyond hiding the Admin step for non-admins.
- Analytics on tour completion.

---

## Data
- Migration: add `tourCompletedAt DateTime?` to `User` (additive, nullable).
- Server action `completeTour()` (`features/onboarding/actions.ts`): sets
  `tourCompletedAt = now()` for the **signed-in user only** (`requireUser`, own id —
  no input, no way to touch another user). Idempotent (no-op if already set).
- Read: the dashboard page already resolves the session user; expose
  `tourCompletedAt` (via `getDashboardScope` or a tiny `getTourState()` query) so the
  page can compute `showTour = tourCompletedAt === null`.

## Tour engine — `features/onboarding/`

### Step model
```ts
interface TourStep {
  target: string | null;   // CSS selector, e.g. '[data-tour="nav-projects"]'; null = centered (welcome/finish)
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right"; // preferred side; auto-fallback if offscreen
}
```
Steps are a static config array (`features/onboarding/steps.ts`), filtered by role
(the Admin step drops when `!isAdmin`).

### `GuidedTour` (client component)
- Props: `steps: TourStep[]`, `autoStart: boolean`, plus an imperative `open()` via a
  small context/store so the Topbar button can start it.
- **Spotlight:** a positioned highlight box over the current target's
  `getBoundingClientRect()` with `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)` — dims the
  whole viewport except the target "hole", plus a `--primary` ring on the hole. For a
  `null` target, a plain dim overlay + centered popover. Before each step, the target is
  `scrollIntoView({ block: "center" })`; the rect is recomputed on step change and on
  `resize`/`scroll` (throttled). If a target is missing from the DOM, skip to the next
  step (never dead-end).
- **Popover:** a `.glass` card (title, body, a "3 of 9" counter, Back / Next / Skip;
  Next becomes "Done" on the last step) positioned beside the target on the preferred
  side, clamped into the viewport. Uses the design tokens; primary button = `--primary`.
- **Interaction:** overlay captures clicks (advancing only via the buttons/keys, so a
  mis-click doesn't dismiss); `Esc` = skip, `←/→` = back/next. Focus moves into the
  popover on open; focus is restored on close (basic focus trap for a11y).
- **Motion:** one quick fade/scale on the popover per step (≤150ms), gated behind
  `prefers-reduced-motion` (instant when reduced). Animate transform/opacity only.
- **Completion:** finishing the last step OR Skip calls `completeTour()` (best-effort)
  and closes. Auto-start only fires when `showTour` is true; replay never re-nags.

### Steps (dashboard overview)
1. Welcome — centered — "Welcome to Flux — a quick tour of the essentials."
2. `nav-dashboard` — "Your home base: KPIs, your work, and recent activity."
3. `nav-inbox` — "Notifications land here — mentions, assignments, comments."
4. `nav-projects` — "Your projects: each has a Kanban board, a backlog, and time reports."
5. `nav-tasks` — "Every task assigned to you, in one list."
6. `nav-admin` — *(admins only)* — "Manage users, invites, per-project access, and API keys."
7. `dashboard-kpis` — "At a glance: open tasks, due soon, in review, completed this week."
8. `dashboard-mywork` — "Your work by priority and due date — change status inline."
9. `create-task` — "Create a task anytime from here."
10. Finish — centered — "That's it. Replay anytime from **Take a tour** in the top bar."

## Anchors (small edits to existing components)
Add `data-tour` attributes:
- `NavLinks.tsx` — each item gets `data-tour={`nav-${slug}`}` (dashboard/inbox/projects/tasks/admin).
- Dashboard `page.tsx` — the KPI grid wrapper → `data-tour="dashboard-kpis"`; the "My work" `Panel` → `data-tour="dashboard-mywork"`; the `CreateTaskDialog` trigger area → `data-tour="create-task"`.
These are inert attributes — zero behaviour change when the tour isn't running.

## Wiring
- Dashboard `page.tsx`: fetch tour state; render `<GuidedTour steps={dashboardTourSteps(isAdmin)} autoStart={showTour} />` at the end of the page (client island; server-fetched flag).
- `Topbar.tsx`: a **"Take a tour"** button (a `HelpCircle` icon / label) that opens the tour via the shared store. If the user isn't on `/dashboard`, it routes to `/dashboard` first (the anchors live there), then opens.
- The auto-start + the button share one `GuidedTour` instance driven by a small client store (`features/onboarding/useTour.ts`) so both entry points control the same tour.

## Craft / performance (per CLAUDE.md motion rules)
- The tour is a deliberate, opt-in-once moment — the ONE place richer motion is fine, but
  keep it fast (≤150ms, transform/opacity only) and fully skippable; `prefers-reduced-motion`
  gets an instant path. It never blocks the dashboard's first paint or data — the dashboard
  renders and is interactive; the tour overlays afterward.
- No dependency added; the engine is a few hundred lines of client code.

## Security / correctness
- `completeTour` mutates only the signed-in user's own row (`requireUser`, no id input) —
  a user can never complete/reset another's tour.
- The `data-tour` attributes expose nothing sensitive.
- Missing-anchor resilience: skip absent targets so a layout change never traps the user.

## Tests
- `completeTour`: sets `tourCompletedAt` for the session user; unauthenticated → rejected;
  idempotent when already set.
- `dashboardTourSteps(isAdmin)`: includes the Admin step iff `isAdmin`; step count/order.
- (Engine positioning is DOM/visual — verified by build + manual smoke, not unit tests.)

## Sequencing (build parts)
1. Migration (`tourCompletedAt`) + `completeTour` action + `getTourState` read + tests. **[migration here]**
2. Tour engine: `useTour` store + `GuidedTour` component + `steps.ts` (`dashboardTourSteps`) + steps test.
3. `data-tour` anchors on `NavLinks` + dashboard page.
4. Wire: dashboard renders `GuidedTour` (autoStart from the flag) + Topbar "Take a tour" button.
