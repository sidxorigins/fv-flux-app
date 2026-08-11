import type { LucideIcon } from "lucide-react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

// Bento stat tiles. Server components — no client JS, nothing animated beyond
// CSS hover, so an 85" board can hold twenty of them without a hydration cost.
//
// Two sizes share one file because they share the delta/tone logic: `HeroStat`
// for the numbers you read across a room, `StatTile` for the supporting grid.

type Tone = "default" | "success" | "warning" | "danger" | "info";

const TONE_TEXT: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

function DeltaBadge({
  delta,
  wall,
  /** Some metrics are better when they fall (bounce rate) — flip the colour
   * without flipping the arrow, which must still show the real direction. */
  invert = false,
}: {
  delta: number | null | undefined;
  wall: boolean;
  invert?: boolean;
}) {
  if (delta === null || delta === undefined) return null;

  const flat = Math.abs(delta) < 0.05;
  const rising = delta > 0;
  const good = invert ? !rising : rising;
  const Icon = flat ? Minus : rising ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        wall ? "text-base" : "text-xs",
        flat ? "text-muted-foreground" : good ? "text-success" : "text-danger",
      )}
    >
      <Icon aria-hidden className={wall ? "size-4" : "size-3"} />
      {flat ? "flat" : `${Math.abs(delta)}%`}
    </span>
  );
}

/** The read-across-the-room number. */
export function HeroStat({
  label,
  value,
  sublabel,
  delta,
  invertDelta,
  tone = "default",
  wall = false,
}: {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
  invertDelta?: boolean;
  tone?: Tone;
  wall?: boolean;
}) {
  return (
    <div className={cn("glass flex flex-col justify-between gap-2", wall ? "p-6" : "p-5")}>
      <span
        className={cn(
          "text-muted-foreground font-medium tracking-wider uppercase",
          wall ? "text-sm" : "text-[11px]",
        )}
      >
        {label}
      </span>

      <span
        className={cn(
          "font-semibold tabular-nums tracking-tight",
          TONE_TEXT[tone],
          wall ? "text-6xl" : "text-4xl",
        )}
      >
        {value}
      </span>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DeltaBadge delta={delta} wall={wall} invert={invertDelta} />
        {sublabel ? (
          <span
            className={cn("text-muted-foreground", wall ? "text-base" : "text-xs")}
          >
            {sublabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Supporting metric in the dense part of the grid. */
export function StatTile({
  icon: Icon,
  label,
  value,
  tone = "default",
  wall = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: Tone;
  wall?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-surface border-border flex flex-col gap-1.5 rounded-xl border",
        wall ? "p-5" : "p-4",
      )}
    >
      <span
        className={cn(
          "text-muted-foreground inline-flex items-center gap-1.5",
          wall ? "text-sm" : "text-[11px]",
        )}
      >
        <Icon aria-hidden className={wall ? "size-4" : "size-3.5"} />
        {label}
      </span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          TONE_TEXT[tone],
          wall ? "text-3xl" : "text-xl",
        )}
      >
        {value}
      </span>
    </div>
  );
}
