import Link from "next/link";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { taskPagePath } from "@/features/tasks/share";
import type { AttentionItem, AttentionKind } from "../attention";

const KIND_META: Record<AttentionKind, { dotClass: string; label: (days: number) => string }> = {
  OVERDUE: {
    dotClass: "bg-danger",
    label: (days) => (days === 1 ? "1 day overdue" : `${days} days overdue`),
  },
  STUCK_IN_REVIEW: {
    dotClass: "bg-warning",
    label: (days) => `${days} days in review`,
  },
  UNOWNED_URGENT: {
    dotClass: "bg-warning",
    // ageDays is a real age-since-creation here, so it is worth showing: an
    // urgent task nobody has owned for three weeks is a different problem from
    // one filed this morning.
    label: (days) => (days === 0 ? "Unassigned, urgent" : `Unassigned ${days}d`),
  },
};

/** Ranked risk list. Server component, zero JS. Locked rows are non-links. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing needs attention — no overdue, stalled, or unowned urgent work.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const meta = KIND_META[item.kind];
        const row = (
          <>
            <span className={cn("size-1.5 shrink-0 rounded-full", meta.dotClass)} aria-hidden />
            <span className="text-muted-foreground w-16 shrink-0 font-mono text-[11px]">
              {item.taskKey}
            </span>
            <span className="text-foreground min-w-0 flex-1 truncate">{item.title}</span>
            <span className="text-muted-foreground hidden shrink-0 text-[11px] sm:inline">
              {item.assigneeName ?? "Unassigned"}
            </span>
            <span className="text-muted-foreground w-28 shrink-0 text-right text-[11px]">
              {meta.label(item.ageDays)}
            </span>
            {item.canOpen ? null : <Lock aria-hidden className="text-muted-foreground size-3" />}
          </>
        );

        return (
          <li key={item.id} className="border-border/60 border-b last:border-b-0">
            {item.canOpen ? (
              <Link
                href={taskPagePath(item.taskKey)}
                className={cn(
                  "flex items-center gap-2 py-2 text-sm",
                  "transition-colors duration-150 motion-reduce:transition-none",
                  "hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                )}
              >
                {row}
              </Link>
            ) : (
              <div
                className="flex items-center gap-2 py-2 text-sm opacity-70"
                title="No project access — ask an admin"
              >
                {row}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
