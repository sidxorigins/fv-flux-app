"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// Rotates the wall board between panes on a fixed interval.
//
// Both panes stay MOUNTED and are crossfaded with opacity — switching by
// unmount/remount would re-run the client components and make the charts
// re-animate on every cycle, which reads as a data change that never happened.
//
// Only `opacity` is animated (no layout properties), per CLAUDE.md's motion
// rules. `prefers-reduced-motion` gets an instant cut rather than a fade.
//
// Rotation ALSO drives the data refresh: every tick advances the pane and calls
// router.refresh(), so the screen coming into view always carries fresh numbers
// rather than whatever was fetched up to a minute earlier.
//
// The refresh fires at the same instant as the switch. router.refresh() patches
// the tree in place rather than remounting, so new data lands mid-crossfade —
// no flash, no reset of this component's own state, and the timer is unaffected
// by the re-render.
//
// Reads hit MetricSnapshot and the local database, never the GA4/store APIs, so
// a short interval costs a handful of indexed queries rather than external
// quota. The cron sync remains the only thing that talks to Google or Apple.

export function DisplayRotator({
  panes,
  intervalSeconds = 60,
}: {
  panes: { key: string; node: ReactNode }[];
  intervalSeconds?: number;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      // Advance only when there is somewhere to advance to. With a single pane
      // (?screen=analytics) the tick still refreshes, so a pinned screen stays
      // just as current as a rotating one.
      if (panes.length > 1) setIndex((i) => (i + 1) % panes.length);
      router.refresh();
    }, intervalSeconds * 1000);

    return () => clearInterval(id);
  }, [panes.length, intervalSeconds, router]);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {panes.map((pane, i) => {
        const active = i === index;
        return (
          <div
            key={pane.key}
            // aria-hidden + inert so a screen reader or keyboard never lands in
            // the pane that isn't on screen.
            aria-hidden={!active}
            inert={!active ? true : undefined}
            className={[
              "absolute inset-0 transition-opacity duration-700 ease-in-out",
              "motion-reduce:transition-none",
              active ? "opacity-100" : "pointer-events-none opacity-0",
            ].join(" ")}
          >
            {pane.node}
          </div>
        );
      })}

      {/* Which pane is showing — small enough to ignore, useful when something
          looks stuck on a screen nobody can interact with. */}
      {panes.length > 1 ? (
        <div className="absolute bottom-[1.2vh] left-1/2 flex -translate-x-1/2 gap-2">
          {panes.map((pane, i) => (
            <span
              key={pane.key}
              className={[
                "block h-[0.5vh] rounded-full transition-all duration-500",
                "motion-reduce:transition-none",
                i === index ? "bg-primary w-[3vh]" : "bg-border w-[1.2vh]",
              ].join(" ")}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
