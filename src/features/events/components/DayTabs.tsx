import Link from "next/link";

import { cn } from "@/lib/utils";

import { formatDayTab, toIsoDate } from "../dates";
import type { EventDayRow } from "../queries";

/**
 * Horizontal day strip. Plain links (`?day=<id>`) so the page stays a Server
 * Component and each day is deep-linkable. "Today" (in the event's zone) gets
 * an orange dot; the unassigned count shows as a small danger badge so a
 * coordinator can spot gaps across the week without opening every day.
 */
export function DayTabs({
  slug,
  days,
  activeDayId,
  todayIso,
}: {
  slug: string;
  days: EventDayRow[];
  activeDayId: string | null;
  todayIso: string;
}) {
  return (
    <nav aria-label="Event days" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {days.map((day) => {
        const { weekday, day: num } = formatDayTab(day.date);
        const active = day.id === activeDayId;
        const isToday = toIsoDate(day.date) === todayIso;
        return (
          <Link
            key={day.id}
            href={`/events/${slug}?day=${day.id}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-w-[4.75rem] shrink-0 flex-col items-center gap-0.5 rounded-xl border px-3 py-2 text-center",
              "transition-colors duration-150 motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border/70 bg-surface/60 text-muted-foreground hover:bg-surface-raised hover:text-foreground",
            )}
          >
            <span className="text-[11px] font-medium tracking-wider uppercase">{weekday}</span>
            <span className="text-xl leading-none font-semibold tabular-nums">{num}</span>
            {day.title ? (
              <span className="mt-0.5 max-w-[7rem] truncate text-[10px] leading-tight text-muted-foreground">
                {day.title}
              </span>
            ) : null}
            {isToday ? (
              <span aria-label="Today" className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
            ) : null}
            {day.unassignedCount > 0 ? (
              <span
                aria-label={`${day.unassignedCount} sessions without crew`}
                className="absolute -top-1.5 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-foreground tabular-nums"
              >
                {day.unassignedCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
