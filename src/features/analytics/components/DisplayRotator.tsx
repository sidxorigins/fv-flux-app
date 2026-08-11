"use client";

import { useEffect, useState, type ReactNode } from "react";

// Rotates the wall board between panes on a fixed interval.
//
// Both panes stay MOUNTED and are crossfaded with opacity — switching by
// unmount/remount would re-run the client components and make the charts
// re-animate on every cycle, which reads as a data change that never happened.
//
// Only `opacity` is animated (no layout properties), per CLAUDE.md's motion
// rules. `prefers-reduced-motion` gets an instant cut rather than a fade.
//
// The interval timer is NOT reset by the parent's 60s data refresh, because
// router.refresh() patches the tree in place rather than remounting — so
// rotation stays on a steady 20s cadence regardless of when data lands.

export function DisplayRotator({
  panes,
  intervalSeconds = 20,
}: {
  panes: { key: string; node: ReactNode }[];
  intervalSeconds?: number;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (panes.length < 2) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % panes.length),
      intervalSeconds * 1000,
    );
    return () => clearInterval(id);
  }, [panes.length, intervalSeconds]);

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
