"use client";

import * as React from "react";

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
    // EXCEPT centered steps (target === null) which are intentional. This
    // adjusts `index` off a DOM check (client-only, not derivable at render
    // time), so it's a deliberate exception to react-hooks/set-state-in-effect.
    if (step.target !== null && !document.querySelector(step.target)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
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
