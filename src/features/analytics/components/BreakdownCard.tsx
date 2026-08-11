import type { LucideIcon } from "lucide-react";

import type { BreakdownSlice } from "@/features/analytics/queries";
import { formatCount } from "@/features/analytics/metrics";
import { cn } from "@/lib/utils";

// Horizontal proportion bars. Deliberately NOT a pie/donut: at wall-viewing
// distance a ranked bar list is read faster and stays legible for colourblind
// viewers, since the label and value are text rather than encoded in hue
// (ui-ux-pro-max: "color is not the only indicator").

export function BreakdownCard({
  icon: Icon,
  title,
  slices,
  wall = false,
}: {
  icon: LucideIcon;
  title: string;
  slices: BreakdownSlice[];
  wall?: boolean;
}) {
  return (
    <section className={cn("glass flex flex-col gap-3", wall ? "p-6" : "p-5")}>
      <h3
        className={cn(
          "text-muted-foreground inline-flex items-center gap-2 font-medium tracking-wider uppercase",
          wall ? "text-sm" : "text-[11px]",
        )}
      >
        <Icon aria-hidden className={wall ? "size-4" : "size-3.5"} />
        {title}
      </h3>

      {slices.length === 0 ? (
        <p className={cn("text-muted-foreground", wall ? "text-base" : "text-sm")}>
          No data yet
        </p>
      ) : (
        <ul className={cn("flex flex-col", wall ? "gap-3" : "gap-2")}>
          {slices.map((slice) => (
            <li key={slice.label} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    "text-foreground truncate",
                    wall ? "text-lg" : "text-sm",
                  )}
                >
                  {slice.label}
                </span>
                <span
                  className={cn(
                    "text-muted-foreground shrink-0 tabular-nums",
                    wall ? "text-base" : "text-xs",
                  )}
                >
                  {formatCount(slice.value)}
                  <span className="text-muted-foreground/70"> · {slice.pct}%</span>
                </span>
              </div>
              <div
                className={cn(
                  "bg-surface-raised w-full overflow-hidden rounded-full",
                  wall ? "h-2" : "h-1.5",
                )}
                role="img"
                aria-label={`${slice.label}: ${slice.value} users, ${slice.pct}%`}
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    // "Other" is the residual tail, not a peer — muted so it
                    // doesn't compete with the real top slices.
                    slice.label === "Other" ? "bg-muted-foreground/40" : "bg-primary",
                  )}
                  style={{ width: `${Math.max(slice.pct, 1.5)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
