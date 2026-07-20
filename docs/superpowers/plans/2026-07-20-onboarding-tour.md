# Guided Onboarding Tour — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A custom, on-brand guided spotlight tour that walks a new user through the Flux dashboard on first login, replayable from the top bar.

**Architecture:** `User.tourCompletedAt` gates auto-start. A module-level client store (`useTour`) lets both the dashboard's `GuidedTour` engine and the Topbar "Take a tour" button drive one tour. The engine spotlights `data-tour`-marked elements with a dimmed overlay + a glass popover. No new dependency.

**Tech Stack:** Next.js 16 (Server Components + Server Actions), React 19 (`useSyncExternalStore`), Prisma 7, Tailwind + Base UI, Vitest.

## Global Constraints

- TS strict — no `any`. Named exports (except page components).
- `completeTour` mutates ONLY the signed-in user's own row (`requireUser`, no id input).
- Prisma migrations only. Tailwind tokens only (glass utility, `--primary`, etc.) — no hardcoded hex.
- Motion: the tour is the one place richer motion is OK, but ≤150ms, transform/opacity only, `prefers-reduced-motion` gets an instant path; never gates the dashboard's first paint/data.
- Missing-anchor resilience: if a step's target isn't in the DOM, skip to the next step (never dead-end).
- Run one test file with `npx vitest run <path>`.

---

### Task 1: Migration + `completeTour` action + `getTourState` (TDD)

**Files:**
- Modify: `prisma/schema.prisma` (`User` model)
- Create: `src/features/onboarding/actions.ts`, `src/features/onboarding/queries.ts`, `src/features/onboarding/actions.test.ts`
- Create migration.

**Interfaces:**
- Produces: `completeTour(): Promise<{ ok: true } | { ok: false; error: string }>`; `getTourState(): Promise<{ completed: boolean }>`.

- [ ] **Step 1: Schema field**

In `prisma/schema.prisma` `model User`, add (near `updatedAt`):
```prisma
  tourCompletedAt DateTime?
```

- [ ] **Step 2: Migrate + regenerate**

Run: `npx prisma migrate dev --name user_tour_completed` then `npx prisma generate`
Expected: additive column; `tourCompletedAt` on the generated `User` type.

- [ ] **Step 3: Write the failing test**

```ts
// src/features/onboarding/actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permissions", () => {
  class AuthorizationError extends Error {
    readonly code: string;
    constructor(c: string) { super(c); this.name = "AuthorizationError"; this.code = c; }
  }
  return { AuthorizationError, requireUser: vi.fn() };
});
vi.mock("@/lib/db", () => ({ prisma: { user: { update: vi.fn() } } }));

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { completeTour } from "./actions";

const update = (prisma as unknown as { user: { update: Mock } }).user.update;
const mockUser = requireUser as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue({ id: "u1", tourCompletedAt: null });
  update.mockResolvedValue({});
});

describe("completeTour", () => {
  it("sets tourCompletedAt for the signed-in user only", async () => {
    const res = await completeTour();
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } }),
    );
    const data = update.mock.calls[0][0].data;
    expect(data.tourCompletedAt).toBeInstanceOf(Date);
  });

  it("is a no-op when already completed (no write)", async () => {
    mockUser.mockResolvedValue({ id: "u1", tourCompletedAt: new Date() });
    const res = await completeTour();
    expect(res).toEqual({ ok: true });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects when unauthenticated", async () => {
    const { AuthorizationError } = await import("@/lib/permissions");
    mockUser.mockRejectedValue(new AuthorizationError("UNAUTHENTICATED"));
    const res = await completeTour();
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run → FAIL** (`npx vitest run src/features/onboarding/actions.test.ts`)

- [ ] **Step 5: Implement `actions.ts` + `queries.ts`**

```ts
// src/features/onboarding/actions.ts
"use server";

import { AuthorizationError, requireUser } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Mark the guided tour complete for the SIGNED-IN user (own row only; no id input).
 * Idempotent — a no-op if already completed. Best-effort from the client.
 */
export async function completeTour(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (user.tourCompletedAt) return { ok: true };
    await prisma.user.update({
      where: { id: user.id },
      data: { tourCompletedAt: new Date() },
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthorizationError) return { ok: false, error: "Not signed in." };
    return { ok: false, error: "Something went wrong." };
  }
}
```

```ts
// src/features/onboarding/queries.ts
import "server-only";
import { requireUser } from "@/lib/permissions";

/** Whether the signed-in user has finished (or dismissed) the onboarding tour. */
export async function getTourState(): Promise<{ completed: boolean }> {
  const user = await requireUser();
  return { completed: user.tourCompletedAt !== null };
}
```

> Note: `queries.ts` imports `"server-only"` — the package is already a dependency
> (added earlier this project). `actions.test.ts` doesn't import `queries.ts`, so no
> mock is needed there.

- [ ] **Step 6: Run → PASS**, then `npm run test` green, commit

```bash
git add prisma/schema.prisma prisma/migrations src/features/onboarding/actions.ts src/features/onboarding/queries.ts src/features/onboarding/actions.test.ts
git commit -m "feat(onboarding): tourCompletedAt + completeTour action + getTourState"
```

---

### Task 2: Tour store + `GuidedTour` engine + steps (TDD for steps)

**Files:**
- Create: `src/features/onboarding/useTour.ts`, `src/features/onboarding/steps.ts`, `src/features/onboarding/steps.test.ts`, `src/features/onboarding/components/GuidedTour.tsx`.

**Interfaces:**
- Produces: `tourStore` (`openTour()`/`closeTour()`/`subscribe`/`get`) + `useTourOpen(): boolean`; `TourStep` type + `dashboardTourSteps(isAdmin: boolean): TourStep[]`; `<GuidedTour steps autoStart />`.

- [ ] **Step 1: `useTour.ts` (module-level external store — drives one tour from two entry points)**

```ts
// src/features/onboarding/useTour.ts
"use client";
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export const tourStore = {
  openTour() { if (!open) { open = true; emit(); } },
  closeTour() { if (open) { open = false; emit(); } },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  get() { return open; },
};

/** Reactive "is the tour open?" — server snapshot false (mismatch-free). */
export function useTourOpen(): boolean {
  return useSyncExternalStore(tourStore.subscribe, tourStore.get, () => false);
}
```

- [ ] **Step 2: Failing steps test**

```ts
// src/features/onboarding/steps.test.ts
import { describe, expect, it } from "vitest";
import { dashboardTourSteps } from "./steps";

describe("dashboardTourSteps", () => {
  it("includes the Admin step only for admins", () => {
    const admin = dashboardTourSteps(true);
    const member = dashboardTourSteps(false);
    expect(admin.some((s) => s.target === '[data-tour="nav-admin"]')).toBe(true);
    expect(member.some((s) => s.target === '[data-tour="nav-admin"]')).toBe(false);
    expect(admin.length).toBe(member.length + 1);
  });
  it("starts with a welcome (no target) and ends with a finish (no target)", () => {
    const steps = dashboardTourSteps(false);
    expect(steps[0]?.target).toBeNull();
    expect(steps[steps.length - 1]?.target).toBeNull();
  });
});
```

- [ ] **Step 3: Run → FAIL**

- [ ] **Step 4: Implement `steps.ts`**

```ts
// src/features/onboarding/steps.ts
export interface TourStep {
  target: string | null; // CSS selector; null = centered (welcome/finish)
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
}

/** The dashboard overview tour. Admin step is included only for admins. */
export function dashboardTourSteps(isAdmin: boolean): TourStep[] {
  return [
    { target: null, title: "Welcome to Flux", body: "A quick tour of the essentials — takes about a minute. You can skip anytime." },
    { target: '[data-tour="nav-dashboard"]', title: "Dashboard", body: "Your home base: KPIs, your work, and recent activity.", placement: "right" },
    { target: '[data-tour="nav-inbox"]', title: "Inbox", body: "Notifications land here — mentions, task assignments, and comments.", placement: "right" },
    { target: '[data-tour="nav-projects"]', title: "Projects", body: "Each project has a Kanban board, a backlog, and time reports.", placement: "right" },
    { target: '[data-tour="nav-tasks"]', title: "My Tasks", body: "Every task assigned to you, in one focused list.", placement: "right" },
    ...(isAdmin
      ? [{ target: '[data-tour="nav-admin"]', title: "Admin", body: "Manage users, invites, per-project access, and API keys.", placement: "right" as const }]
      : []),
    { target: '[data-tour="dashboard-kpis"]', title: "Your KPIs", body: "At a glance: open tasks, due soon, in review, and completed this week.", placement: "bottom" },
    { target: '[data-tour="dashboard-mywork"]', title: "My work", body: "Your tasks by priority and due date — change status inline, no page load.", placement: "top" },
    { target: '[data-tour="create-task"]', title: "Create a task", body: "Spin up a task anytime from here.", placement: "bottom" },
    { target: null, title: "You're set", body: "That's the tour. Replay anytime from “Take a tour” in the top bar." },
  ];
}
```

- [ ] **Step 5: Run → PASS** (`npx vitest run src/features/onboarding/steps.test.ts`)

- [ ] **Step 6: Implement `GuidedTour.tsx`**

```tsx
// src/features/onboarding/components/GuidedTour.tsx
"use client";

import * as React from "react";
import { toast } from "sonner";

import { completeTour } from "../actions";
import { tourStore, useTourOpen } from "../useTour";
import type { TourStep } from "../steps";

const PAD = 8; // spotlight padding around the target
const GAP = 12; // popover gap from the target

interface Rect { top: number; left: number; width: number; height: number }

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export interface GuidedTourProps {
  steps: TourStep[];
  /** True on first-run (server-computed from tourCompletedAt). */
  autoStart: boolean;
}

export function GuidedTour({ steps, autoStart }: GuidedTourProps) {
  const open = useTourOpen();
  const [index, setIndex] = React.useState(0);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const popRef = React.useRef<HTMLDivElement>(null);

  // First-run auto-start (once per mount).
  React.useEffect(() => {
    if (autoStart) tourStore.openTour();
  }, [autoStart]);

  const step = steps[index];

  // Resolve the current target: scroll into view, measure, skip if missing.
  const measure = React.useCallback(() => {
    if (!step) return;
    if (step.target === null) { setRect(null); return; }
    const el = document.querySelector(step.target);
    if (!el) { setRect(null); return; } // absent → treated as centered (Next still works)
    setRect(rectOf(el));
  }, [step]);

  React.useEffect(() => {
    if (!open || !step) return;
    // Skip a step whose target selector exists in config but not in the DOM,
    // EXCEPT centered steps (target === null) which are intentional.
    if (step.target !== null && !document.querySelector(step.target)) {
      setIndex((i) => Math.min(i + 1, steps.length - 1));
      return;
    }
    if (step.target) {
      document.querySelector(step.target)?.scrollIntoView({ block: "center", inline: "nearest" });
    }
    measure();
    popRef.current?.focus();
  }, [open, index, step, steps.length, measure]);

  // Keep the spotlight aligned on scroll/resize.
  React.useEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, measure]);

  const finish = React.useCallback(() => {
    tourStore.closeTour();
    setIndex(0);
    void completeTour().then((r) => { if (!r.ok) { /* silent — best effort */ } });
  }, []);

  const next = React.useCallback(() => {
    setIndex((i) => (i >= steps.length - 1 ? (finish(), 0) : i + 1));
  }, [steps.length, finish]);
  const back = React.useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Keyboard.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, back, finish]);

  if (!open || !step) return null;

  // Popover position: beside the target on the preferred side, clamped to viewport.
  const pop = popoverPosition(rect, step.placement);

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Spotlight: a box over the target with a giant shadow that dims everything else.
          When there's no target, a plain dim overlay. */}
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl ring-2 ring-primary transition-[top,left,width,height] duration-150 motion-reduce:transition-none"
          style={{
            top: rect.top - PAD, left: rect.left - PAD,
            width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/60" />
      )}

      {/* Popover */}
      <div
        ref={popRef}
        tabIndex={-1}
        className="glass fixed w-[min(20rem,calc(100vw-2rem))] p-4 outline-none animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
        style={pop}
      >
        <h2 className="text-sm font-semibold text-foreground">{step.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {index + 1} of {steps.length}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={finish}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              Skip
            </button>
            {index > 0 ? (
              <button type="button" onClick={back}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring/50">
                Back
              </button>
            ) : null}
            <button type="button" onClick={next}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring/50">
              {index >= steps.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Position the popover beside `rect` (or centered when null), clamped to the viewport. */
function popoverPosition(rect: Rect | null, placement: TourStep["placement"]): React.CSSProperties {
  const W = 320; // matches the max-width above
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
  const clampL = (l: number) => Math.max(16, Math.min(l, vw - W - 16));
  const clampT = (t: number) => Math.max(16, Math.min(t, vh - 16 - 120));
  switch (placement) {
    case "right": return { top: clampT(rect.top), left: clampL(rect.left + rect.width + GAP) };
    case "left":  return { top: clampT(rect.top), left: clampL(rect.left - W - GAP) };
    case "top":   return { top: clampT(rect.top - GAP - 140), left: clampL(rect.left) };
    case "bottom":
    default:      return { top: clampT(rect.top + rect.height + GAP), left: clampL(rect.left) };
  }
}
```

- [ ] **Step 7: Typecheck** — `npx tsc --noEmit 2>&1 | grep -iE "GuidedTour|onboarding" || echo OK` → `OK`

- [ ] **Step 8: Commit**

```bash
git add src/features/onboarding/useTour.ts src/features/onboarding/steps.ts src/features/onboarding/steps.test.ts src/features/onboarding/components/GuidedTour.tsx
git commit -m "feat(onboarding): tour store + GuidedTour engine + dashboard steps"
```

---

### Task 3: `data-tour` anchors

**Files:**
- Modify: `src/components/shell/NavLinks.tsx`
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: NavLinks — add a tour id per item**

Add `tourId` to the `NavItem` interface and to each item, then render it as `data-tour`:

```ts
interface NavItem { href: string; label: string; icon: LucideIcon; tourId: string }
const BASE_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tourId: "nav-dashboard" },
  { href: "/inbox", label: "Inbox", icon: Inbox, tourId: "nav-inbox" },
  { href: "/projects", label: "Projects", icon: FolderKanban, tourId: "nav-projects" },
  { href: "/tasks", label: "My Tasks", icon: ListTodo, tourId: "nav-tasks" },
];
const ADMIN_NAV_ITEM: NavItem = { href: "/admin", label: "Admin", icon: Shield, tourId: "nav-admin" };
```
On the `<Link>`, add `data-tour={tourId}` (destructure `tourId` in the `.map`).

- [ ] **Step 2: Dashboard anchors**

In `src/app/(dashboard)/dashboard/page.tsx`:
- On the KPI grid wrapper `<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">` add `data-tour="dashboard-kpis"`.
- Wrap the "My work" `Panel` in a `data-tour` div (Panel doesn't forward arbitrary attrs):
  ```tsx
  <div data-tour="dashboard-mywork">
    <Panel title="My work" scope="you" action={/* ...unchanged... */}>
      <GroupedWorkList work={work} />
    </Panel>
  </div>
  ```
- Wrap the create-task control: change `{creatable.length > 0 ? (<CreateTaskDialog projects={creatable} />) : null}` to
  ```tsx
  {creatable.length > 0 ? (
    <span data-tour="create-task"><CreateTaskDialog projects={creatable} /></span>
  ) : null}
  ```

- [ ] **Step 3: Build** — `npm run build 2>&1 | tail -3` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/shell/NavLinks.tsx "src/app/(dashboard)/dashboard/page.tsx"
git commit -m "feat(onboarding): data-tour anchors on nav + dashboard"
```

---

### Task 4: Wire auto-start + Topbar "Take a tour"

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx` (render `GuidedTour`)
- Create: `src/features/onboarding/components/TakeTourButton.tsx`
- Modify: `src/components/shell/Topbar.tsx` (render the button)

- [ ] **Step 1: Render `GuidedTour` on the dashboard**

In `dashboard/page.tsx`:
- Import: `import { GuidedTour } from "@/features/onboarding/components/GuidedTour"`, `import { dashboardTourSteps } from "@/features/onboarding/steps"`, `import { getTourState } from "@/features/onboarding/queries"`.
- Add `getTourState()` to the initial `Promise.all` (destructure as `tour`), OR call it standalone near the top. Compute `const isAdmin = scope.isAdmin`.
- At the very end of the returned JSX (inside `DashboardEntrance`, after the last section), render:
  ```tsx
  <GuidedTour steps={dashboardTourSteps(scope.isAdmin)} autoStart={!tour.completed} />
  ```
  (`scope.isAdmin` is already on `getDashboardScope()`'s result.)

- [ ] **Step 2: `TakeTourButton.tsx` (client)**

```tsx
// src/features/onboarding/components/TakeTourButton.tsx
"use client";

import { HelpCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { tourStore } from "../useTour";

/**
 * Replays the tour. The tour's anchors live on /dashboard, so if we're elsewhere
 * we route there first; the GuidedTour instance on the dashboard reacts to the
 * shared store and starts on mount.
 */
export function TakeTourButton() {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <button
      type="button"
      aria-label="Take a tour"
      title="Take a tour"
      onClick={() => {
        tourStore.openTour();
        if (pathname !== "/dashboard") router.push("/dashboard");
      }}
      className="rounded-full p-2 text-muted-foreground outline-none transition-colors duration-150 hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
    >
      <HelpCircle className="size-5" aria-hidden />
    </button>
  );
}
```

- [ ] **Step 3: Render it in the Topbar**

In `Topbar.tsx`, import `TakeTourButton` and place it in the right-hand cluster, before `<CommandPalette />`:
```tsx
import { TakeTourButton } from "@/features/onboarding/components/TakeTourButton";
// ...
<div className="flex shrink-0 items-center gap-2">
  <TakeTourButton />
  <CommandPalette />
  ...
```

- [ ] **Step 4: Build + lint** — `npm run build && npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/dashboard/page.tsx" src/features/onboarding/components/TakeTourButton.tsx src/components/shell/Topbar.tsx
git commit -m "feat(onboarding): auto-start on first login + Take a tour button"
```

---

# Final verification

- [ ] **Full suite** — `npm run test` → all pass (new: completeTour, steps).
- [ ] **Lint + build** — `npm run lint && npm run build` → clean.
- [ ] **Manual smoke** (`npm run dev`):
  1. As a user with `tourCompletedAt = null` → dashboard auto-starts the tour; overlay dims, first target is the Dashboard nav link; Next walks through nav → KPIs → My work → Create task → Done; Skip/Esc closes and sets the flag.
  2. Reload → tour does NOT auto-start again.
  3. Click "Take a tour" (top bar) from another page → routes to /dashboard and starts.
  4. Non-admin → no Admin step. `prefers-reduced-motion` → no animation, still functional.

---

## Notes for the implementer
- The spotlight is the `box-shadow: 0 0 0 9999px` trick on a box over the target — no SVG mask needed.
- `useSyncExternalStore` with a `() => false` server snapshot keeps the tour hydration-safe (never renders server-side).
- Keep `data-tour` attributes inert — they must not change any behaviour when the tour isn't running.
- `completeTour` is best-effort from the client (fire-and-forget) — a failure just means the tour may show again; never surface an error toast for it.
- The popover uses `animate-in fade-in zoom-in-95` (tailwindcss-animate). If those utilities aren't available in this project, they're harmless no-ops (the popover just appears without animation) — do NOT add a dependency for them; confirm the build is clean and move on.
- `toast` is imported in GuidedTour but `completeTour` failures are silent per the note above — if the `toast` import ends up unused, remove it (don't leave a dead import).
