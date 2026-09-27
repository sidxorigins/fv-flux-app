import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Clock, Flame, MapPin, ShieldCheck, UserX, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { getDaySchedule, getEventBySlug, listCrewCandidates, type CrewUser } from "@/features/events/queries";
import { formatDateRange, formatDayLong, toIsoDate } from "@/features/events/dates";
import { DayTabs } from "@/features/events/components/DayTabs";
import { DaySchedule } from "@/features/events/components/DaySchedule";
import { DayHeaderEditor } from "@/features/events/components/DayHeaderEditor";
import { CrewLoadPanel } from "@/features/events/components/CrewLoadPanel";
import { CrewAvatar } from "@/features/events/components/CrewAvatar";
import { EventSettingsDialog } from "@/features/events/components/EventSettingsDialog";
import { DashboardEntrance } from "@/features/dashboard/components/DashboardEntrance";

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Users; tone?: string }) {
  return (
    <div className="glass flex items-center gap-3 px-4 py-3">
      <Icon aria-hidden className={cn("size-4 shrink-0", tone ?? "text-foreground")} />
      <div className="flex flex-col">
        <span className="text-xl leading-none font-semibold text-foreground tabular-nums">{value}</span>
        <span className="text-[11px] font-medium tracking-wider text-foreground uppercase">{label}</span>
      </div>
    </div>
  );
}

/**
 * The event run sheet. Server-rendered: the selected day (`?day=`) is fetched
 * here with its sessions, and only the list (filters, dialogs) hydrates.
 */
export default async function EventSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const [{ slug }, { day: requestedDay }] = await Promise.all([params, searchParams]);
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const activeDay = event.days.find((d) => d.id === requestedDay) ?? event.days.find((d) => d.id === event.defaultDayId) ?? null;

  const [schedule, candidates] = await Promise.all([
    activeDay ? getDaySchedule(activeDay.id) : Promise.resolve(null),
    event.canEdit ? listCrewCandidates() : Promise.resolve([] as CrewUser[]),
  ]);

  const sessions = schedule?.sessions ?? [];
  const mine = sessions.filter((s) => s.owner?.id === event.currentUserId || s.crew.some((c) => c.user.id === event.currentUserId));
  const unassigned = sessions.filter((s) => !s.owner && s.crew.length === 0);
  const mustFilm = sessions.filter((s) => s.priority === "MUST_FILM");
  const covered = sessions.filter((s) => s.completedAt);
  const isToday = activeDay ? toIsoDate(activeDay.date) === event.todayIso : false;

  return (
    <DashboardEntrance>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col gap-4">
          <Link href="/events" className="inline-flex w-fit items-center gap-1 text-xs text-foreground hover:text-primary">
            <ArrowLeft aria-hidden className="size-3.5" /> All events
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{event.name}</h1>
              {event.subtitle ? <p className="text-sm text-foreground">{event.subtitle}</p> : null}
              <dl className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-sm text-foreground">
                <div className="inline-flex items-center gap-1.5">
                  <CalendarDays aria-hidden className="size-4" />
                  <dd>{formatDateRange(event.startDate, event.endDate)}</dd>
                </div>
                {event.venue ? (
                  <div className="inline-flex items-center gap-1.5">
                    <MapPin aria-hidden className="size-4" />
                    <dd>{event.venue}</dd>
                  </div>
                ) : null}
                <div className="inline-flex items-center gap-1.5">
                  <Clock aria-hidden className="size-4" />
                  <dd>{event.timezone}</dd>
                </div>
              </dl>
            </div>
            <div className="flex items-center gap-3">
              {event.managers.length > 0 ? (
                <div className="flex items-center gap-1.5" aria-label="Schedule managers">
                  <ShieldCheck aria-hidden className="size-4 text-foreground" />
                  <div className="flex -space-x-1.5">
                    {event.managers.map((m) => (
                      <CrewAvatar key={m.id} user={m} />
                    ))}
                  </div>
                </div>
              ) : null}
              {event.canEdit ? <EventSettingsDialog event={event} candidates={candidates} /> : null}
            </div>
          </div>
        </div>

        <DayTabs slug={event.slug} days={event.days} activeDayId={activeDay?.id ?? null} todayIso={event.todayIso} />

        {activeDay ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="flex min-w-0 flex-col gap-5">
              {/* Day heading */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold tracking-tight text-foreground">{formatDayLong(activeDay.date)}</h2>
                    {isToday ? (
                      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-primary uppercase">Today</span>
                    ) : null}
                  </div>
                  {activeDay.title ? <p className="text-sm font-medium text-foreground/80">{activeDay.title}</p> : null}
                  {activeDay.notes ? <p className="max-w-3xl text-sm leading-relaxed text-foreground">{activeDay.notes}</p> : null}
                </div>
                {event.canEdit ? (
                  <DayHeaderEditor
                    eventId={event.id}
                    slug={event.slug}
                    day={{ id: activeDay.id, title: activeDay.title, notes: activeDay.notes, iso: toIsoDate(activeDay.date) }}
                    canDelete={event.days.length > 1}
                  />
                ) : null}
              </div>

              {/* KPI strip */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Sessions" value={sessions.length} icon={CalendarDays} />
                <Kpi label="Must film" value={mustFilm.length} icon={Flame} tone="text-danger" />
                <Kpi label="No crew" value={unassigned.length} icon={UserX} tone={unassigned.length > 0 ? "text-warning" : "text-success"} />
                <Kpi label="Yours" value={mine.length} icon={Users} tone="text-primary" />
              </div>

              <DaySchedule
                key={activeDay.id}
                dayId={activeDay.id}
                sessions={sessions}
                canEdit={event.canEdit}
                currentUserId={event.currentUserId}
                candidates={candidates}
              />
            </div>

            <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
              <CrewLoadPanel crewLoad={schedule?.crewLoad ?? []} total={sessions.length} />
              <div className="glass flex flex-col gap-1 p-4">
                <span className="text-xs font-medium tracking-wider text-foreground uppercase">Progress</span>
                <span className="text-2xl font-semibold text-foreground tabular-nums">
                  {covered.length}
                  <span className="text-base font-normal text-foreground"> / {sessions.length} covered</span>
                </span>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised" aria-hidden>
                  <div className="h-full rounded-full bg-success" style={{ width: `${sessions.length ? Math.round((covered.length / sessions.length) * 100) : 0}%` }} />
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <div className="glass mx-auto mt-6 flex w-full max-w-md flex-col items-center gap-2 px-8 py-12 text-center">
            <p className="text-base font-medium text-foreground">This event has no days</p>
            <p className="text-sm text-foreground">Add a day from the settings to start the run sheet.</p>
          </div>
        )}
      </div>
    </DashboardEntrance>
  );
}
