import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";

import { requireUser } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { listEvents, type EventListRow } from "@/features/events/queries";
import { CreateEventDialog } from "@/features/events/components/CreateEventDialog";
import { formatDateRange } from "@/features/events/dates";
import { DashboardEntrance } from "@/features/dashboard/components/DashboardEntrance";

const STATUS_META: Record<EventListRow["status"], { label: string; className: string }> = {
  live: { label: "Live now", className: "bg-success/10 text-success" },
  upcoming: { label: "Upcoming", className: "bg-info/10 text-info" },
  past: { label: "Past", className: "bg-foreground/10 text-foreground" },
};

function EventTile({ event }: { event: EventListRow }) {
  const status = STATUS_META[event.status];
  return (
    <Link
      href={`/events/${event.slug}`}
      className={cn(
        "glass group flex flex-col gap-4 p-5 outline-none",
        "transition-colors duration-150 hover:bg-surface-raised/40 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">{event.name}</h2>
          {event.subtitle ? <p className="truncate text-sm text-foreground">{event.subtitle}</p> : null}
        </div>
        <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase", status.className)}>
          {status.label}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-foreground">
        <div className="inline-flex items-center gap-1.5">
          <CalendarDays aria-hidden className="size-4" />
          <dd>{formatDateRange(event.startDate, event.endDate)}</dd>
        </div>
        {event.venue ? (
          <div className="inline-flex items-center gap-1.5">
            <MapPin aria-hidden className="size-4" />
            <dd className="truncate">{event.venue}</dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-auto flex items-end justify-between gap-3">
        <div className="flex gap-5">
          <Stat label="days" value={event.dayCount} />
          <Stat label="sessions" value={event.sessionCount} />
          <Stat label="yours" value={event.mySessionCount} highlight={event.mySessionCount > 0} />
        </div>
        <ArrowRight aria-hidden className="size-4 text-foreground transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </div>
    </Link>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={cn("text-2xl leading-none font-semibold tabular-nums", highlight ? "text-primary" : "text-foreground")}>{value}</span>
      <span className="text-[11px] font-medium tracking-wider text-foreground uppercase">{label}</span>
    </div>
  );
}

/** Company-wide event schedules (run sheets). Any active user can read; Admins create. */
export default async function EventsPage() {
  const [user, events] = await Promise.all([requireUser(), listEvents()]);
  const isAdmin = user.globalRole === "ADMIN";
  const hasExpogast = events.some((e) => e.slug === "expogast-2026");

  return (
    <DashboardEntrance>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Events</h1>
            <p className="text-sm text-foreground">Day-by-day run sheets: who covers what, where, and when.</p>
          </div>
          {isAdmin ? <CreateEventDialog hasExpogast={hasExpogast} /> : null}
        </div>

        {events.length === 0 ? (
          <div className="glass mx-auto mt-10 flex w-full max-w-md flex-col items-center gap-2 px-8 py-12 text-center">
            <CalendarDays aria-hidden className="size-6 text-foreground" />
            <p className="text-base font-medium text-foreground">No events yet</p>
            <p className="text-sm text-foreground">
              {isAdmin ? "Import the Expogast 2026 run sheet or create a blank event." : "An admin will add the first event schedule."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {events.map((e) => (
              <EventTile key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>
    </DashboardEntrance>
  );
}
