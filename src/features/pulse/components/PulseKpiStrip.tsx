import { AlertTriangle, CheckCircle2, Eye, ListTodo, Users } from "lucide-react";

import type { PulseKpis } from "@/features/pulse/queries";
import { cn } from "@/lib/utils";

/**
 * Org-level headline numbers above the person cards. Server component, no
 * animation — per CLAUDE.md the dashboard "looks great sitting perfectly
 * still", and a count-up would delay the real number on a wall display.
 */
export function PulseKpiStrip({
  kpis,
  wall = false,
}: {
  kpis: PulseKpis;
  wall?: boolean;
}) {
  const cards = [
    {
      label: "Working now",
      value: `${kpis.working}/${kpis.headcount}`,
      icon: Users,
      tone: kpis.working > 0 ? ("success" as const) : undefined,
    },
    { label: "Open tasks", value: kpis.open, icon: ListTodo },
    {
      label: "Overdue",
      value: kpis.overdue,
      icon: AlertTriangle,
      tone: kpis.overdue > 0 ? ("danger" as const) : undefined,
    },
    {
      label: "In review",
      value: kpis.inReview,
      icon: Eye,
      tone: kpis.inReview > 0 ? ("warning" as const) : undefined,
    },
    {
      label: "Done this week",
      value: kpis.completedThisWeek,
      icon: CheckCircle2,
      tone: kpis.completedThisWeek > 0 ? ("success" as const) : undefined,
    },
  ];

  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2 lg:grid-cols-5",
        wall && "gap-5",
      )}
    >
      {cards.map(({ label, value, icon: Icon, tone }) => (
        <div
          key={label}
          className={cn("glass flex flex-col gap-2", wall ? "p-6" : "p-4")}
        >
          <span
            className={cn(
              "text-muted-foreground inline-flex items-center gap-2",
              wall ? "text-base" : "text-xs",
            )}
          >
            <Icon aria-hidden className={wall ? "size-5" : "size-3.5"} />
            {label}
          </span>
          <span
            className={cn(
              "font-semibold tabular-nums",
              wall ? "text-5xl" : "text-2xl",
              tone === "danger" && "text-danger",
              tone === "warning" && "text-warning",
              tone === "success" && "text-success",
              !tone && "text-foreground",
            )}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}
