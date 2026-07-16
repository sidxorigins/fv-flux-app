import { MoveDown, MoveUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * What a rising number MEANS for this metric — drives the delta chip colour.
 * "up-good": more is progress (completed this week) → ▲ success / ▼ muted.
 * "up-bad":  more is trouble (overdue)              → ▲ danger  / ▼ success.
 */
export type DeltaMeaning = "up-good" | "up-bad";

export interface KpiCardProps {
  label: string;
  value: number;
  /** Small icon rendered top-right in a functional colour. */
  icon: LucideIcon;
  /** Tailwind text-* class carrying the icon's functional colour. */
  iconClass?: string;
  /** Delta vs last week; omit for metrics with no baseline. */
  delta?: { value: number; meaning: DeltaMeaning };
  /** Muted caption under the number (used when there's no delta). */
  caption?: React.ReactNode;
}

function deltaClasses(value: number, meaning: DeltaMeaning): string {
  if (value === 0) return "text-muted-foreground";
  const improving = meaning === "up-good" ? value > 0 : value < 0;
  if (improving) return "bg-success/10 px-1.5 text-success";
  // Worsening: only alarm when more genuinely means trouble.
  return meaning === "up-bad"
    ? "bg-danger/10 px-1.5 text-danger"
    : "text-muted-foreground";
}

/**
 * Glass KPI stat card (server-compatible — zero client JS). The number is the
 * real value from the first paint: no count-up, nothing gates readability.
 */
export function KpiCard({
  label,
  value,
  icon: Icon,
  iconClass,
  delta,
  caption,
}: KpiCardProps) {
  return (
    <div className="glass flex flex-col gap-2 p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {label}
        </span>
        <Icon
          aria-hidden
          className={cn(
            "size-4 shrink-0",
            iconClass ?? "text-muted-foreground",
          )}
        />
      </div>

      <span className="text-foreground text-3xl leading-none font-semibold tracking-tight tabular-nums">
        {value}
      </span>

      {delta ? (
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1 rounded-md py-0.5 text-[11px] font-medium tabular-nums",
            deltaClasses(delta.value, delta.meaning),
          )}
        >
          {delta.value > 0 ? (
            <MoveUp aria-hidden className="size-3" />
          ) : delta.value < 0 ? (
            <MoveDown aria-hidden className="size-3" />
          ) : null}
          {delta.value > 0 ? `+${delta.value}` : delta.value}
          <span className="font-normal">vs last week</span>
        </span>
      ) : caption ? (
        <span className="text-muted-foreground text-[11px]">{caption}</span>
      ) : null}
    </div>
  );
}
