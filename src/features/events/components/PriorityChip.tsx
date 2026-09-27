import { Flame, ArrowUp, Minus, type LucideIcon } from "lucide-react";

import type { SessionPriority } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * Session priority metadata — MUST FILM danger / HIGH warning / OPTIONAL muted.
 * Functional colours only; orange stays reserved for accents (CLAUDE.md).
 */
export const SESSION_PRIORITY_META: Record<
  SessionPriority,
  { label: string; short: string; icon: LucideIcon; chipClass: string; barClass: string }
> = {
  MUST_FILM: {
    label: "Must film",
    short: "MUST",
    icon: Flame,
    chipClass: "bg-danger/10 text-danger",
    barClass: "bg-danger",
  },
  HIGH: {
    label: "High",
    short: "HIGH",
    icon: ArrowUp,
    chipClass: "bg-warning/10 text-warning",
    barClass: "bg-warning",
  },
  OPTIONAL: {
    label: "Optional",
    short: "OPT",
    icon: Minus,
    chipClass: "bg-muted-foreground/10 text-muted-foreground",
    barClass: "bg-muted-foreground/60",
  },
};

export const SESSION_PRIORITY_ORDER = ["MUST_FILM", "HIGH", "OPTIONAL"] as const satisfies readonly SessionPriority[];

export function PriorityChip({ priority, className }: { priority: SessionPriority; className?: string }) {
  const meta = SESSION_PRIORITY_META[priority];
  const Icon = meta.icon;
  return (
    <span
      data-slot="priority-chip"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold tracking-wide whitespace-nowrap uppercase",
        meta.chipClass,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {meta.label}
    </span>
  );
}
