"use client";

import * as React from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

// Once per browser session — navigating back to the dashboard renders
// instantly with no re-animation.
const SESSION_KEY = "flux:dashboard-entered";

function alreadyEntered(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return true;
    sessionStorage.setItem(SESSION_KEY, "1");
    return false;
  } catch {
    // Storage unavailable (private mode etc.) → skip the animation entirely.
    return true;
  }
}

/**
 * THE one dashboard entrance (CLAUDE.md allows exactly one): a single quick
 * fade/rise of the whole grid — no stagger — via a GSAP tween on a wrapper.
 *
 * Fast-first guarantees:
 * - Server-rendered content paints at full opacity first; the tween starts
 *   only after hydration (useGSAP), so nothing gates data or first paint.
 * - transform/opacity only; pointer events stay live throughout (opacity
 *   never blocks clicks) — a KPI card is clickable mid-animation.
 * - Skipped under prefers-reduced-motion and after the first run per session.
 * - clearProps removes the wrapper transform on completion so it can't create
 *   a stray containing block for fixed/backdrop descendants.
 * - useGSAP reverts the tween on unmount — nothing leaks across routes.
 */
export function DashboardEntrance({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (alreadyEntered()) return;

      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 8 },
        {
          opacity: 1,
          y: 0,
          duration: 0.25,
          ease: "power2.out",
          clearProps: "opacity,transform",
        },
      );
    },
    { scope: ref },
  );

  return <div ref={ref}>{children}</div>;
}
