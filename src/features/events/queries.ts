import "server-only";

import { prisma } from "@/lib/db";
import { canEditEvent, requireUser } from "@/lib/permissions";
import { getAvatarUrl } from "@/features/users/avatar";
import type { SessionPriority } from "@/generated/prisma/enums";

import { pickDefaultDay, todayInZone, toIsoDate } from "./dates";

// Read side of event schedules. Every function authorises unconditionally:
// any ACTIVE user may read (company-wide run sheet), and `canEdit` is resolved
// server-side so the UI can hide controls the caller can't use — the actions
// re-check regardless.

export interface CrewUser {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

export interface EventListRow {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  venue: string | null;
  startDate: Date;
  endDate: Date;
  timezone: string;
  dayCount: number;
  sessionCount: number;
  /** Sessions the caller owns or is crewed on. */
  mySessionCount: number;
  status: "upcoming" | "live" | "past";
}

function eventStatus(start: Date, end: Date, timezone: string): EventListRow["status"] {
  const today = todayInZone(timezone);
  if (today < toIsoDate(start)) return "upcoming";
  if (today > toIsoDate(end)) return "past";
  return "live";
}

export async function listEvents(): Promise<EventListRow[]> {
  const user = await requireUser();
  const events = await prisma.event.findMany({
    orderBy: [{ startDate: "desc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      subtitle: true,
      venue: true,
      startDate: true,
      endDate: true,
      timezone: true,
      _count: { select: { days: true, sessions: true } },
    },
  });
  if (events.length === 0) return [];

  const mine = await prisma.eventSession.groupBy({
    by: ["eventId"],
    where: {
      OR: [{ ownerId: user.id }, { assignments: { some: { userId: user.id } } }],
    },
    _count: { _all: true },
  });
  const mineByEvent = new Map(mine.map((m) => [m.eventId, m._count._all]));

  return events.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    subtitle: e.subtitle,
    venue: e.venue,
    startDate: e.startDate,
    endDate: e.endDate,
    timezone: e.timezone,
    dayCount: e._count.days,
    sessionCount: e._count.sessions,
    mySessionCount: mineByEvent.get(e.id) ?? 0,
    status: eventStatus(e.startDate, e.endDate, e.timezone),
  }));
}

export interface EventDayRow {
  id: string;
  date: Date;
  title: string | null;
  notes: string | null;
  sessionCount: number;
  mustFilmCount: number;
  unassignedCount: number;
}

export interface EventDetail {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  venue: string | null;
  startDate: Date;
  endDate: Date;
  timezone: string;
  todayIso: string;
  canEdit: boolean;
  isAdmin: boolean;
  currentUserId: string;
  managers: CrewUser[];
  days: EventDayRow[];
  /** The day the page should open on when none is requested. */
  defaultDayId: string | null;
}

export async function getEventBySlug(slug: string): Promise<EventDetail | null> {
  const user = await requireUser();
  const event = await prisma.event.findUnique({
    where: { slug },
    include: {
      managers: {
        include: { user: { select: { id: true, name: true, username: true, avatarKey: true } } },
        orderBy: { createdAt: "asc" },
      },
      days: {
        orderBy: { date: "asc" },
        select: {
          id: true,
          date: true,
          title: true,
          notes: true,
          sessions: { select: { priority: true, ownerId: true, assignments: { select: { id: true }, take: 1 } } },
        },
      },
    },
  });
  if (!event) return null;

  const [canEdit, managers] = await Promise.all([
    canEditEvent(user.id, event.id),
    Promise.all(
      event.managers.map(async (m) => ({
        id: m.user.id,
        name: m.user.name,
        username: m.user.username,
        avatarUrl: await getAvatarUrl(m.user.avatarKey),
      })),
    ),
  ]);

  const days: EventDayRow[] = event.days.map((d) => ({
    id: d.id,
    date: d.date,
    title: d.title,
    notes: d.notes,
    sessionCount: d.sessions.length,
    mustFilmCount: d.sessions.filter((s) => s.priority === "MUST_FILM").length,
    unassignedCount: d.sessions.filter((s) => !s.ownerId && s.assignments.length === 0).length,
  }));

  const todayIso = todayInZone(event.timezone);
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    subtitle: event.subtitle,
    venue: event.venue,
    startDate: event.startDate,
    endDate: event.endDate,
    timezone: event.timezone,
    todayIso,
    canEdit,
    isAdmin: user.globalRole === "ADMIN",
    currentUserId: user.id,
    managers,
    days,
    defaultDayId: pickDefaultDay(days, todayIso)?.id ?? null,
  };
}

export interface SessionAssignmentRow {
  user: CrewUser;
  role: string | null;
}

export interface SessionRow {
  id: string;
  dayId: string;
  title: string;
  location: string | null;
  focus: string | null;
  startTime: string | null;
  endTime: string | null;
  timeLabel: string | null;
  priority: SessionPriority;
  position: number;
  completedAt: Date | null;
  owner: CrewUser | null;
  crew: SessionAssignmentRow[];
}

export interface DaySchedule {
  dayId: string;
  sessions: SessionRow[];
  /** Per-person load for the day (owner or crew), sorted by count desc then name. */
  crewLoad: { user: CrewUser; sessions: number; mustFilm: number }[];
}

export async function getDaySchedule(dayId: string): Promise<DaySchedule> {
  await requireUser();
  const userSelect = { id: true, name: true, username: true, avatarKey: true } as const;
  const sessions = await prisma.eventSession.findMany({
    where: { dayId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      owner: { select: userSelect },
      assignments: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: userSelect } },
      },
    },
  });

  // Resolve every distinct avatar once — presigning is memoised but not free.
  const userMap = new Map<string, { id: string; name: string; username: string; avatarKey: string | null }>();
  for (const s of sessions) {
    if (s.owner) userMap.set(s.owner.id, s.owner);
    for (const a of s.assignments) userMap.set(a.user.id, a.user);
  }
  const crew = new Map<string, CrewUser>();
  await Promise.all(
    [...userMap.values()].map(async (u) => {
      crew.set(u.id, { id: u.id, name: u.name, username: u.username, avatarUrl: await getAvatarUrl(u.avatarKey) });
    }),
  );

  const load = new Map<string, { sessions: number; mustFilm: number }>();
  const bump = (userId: string, mustFilm: boolean) => {
    const cur = load.get(userId) ?? { sessions: 0, mustFilm: 0 };
    cur.sessions += 1;
    if (mustFilm) cur.mustFilm += 1;
    load.set(userId, cur);
  };

  const rows: SessionRow[] = sessions.map((s) => {
    const seen = new Set<string>();
    if (s.owner) {
      seen.add(s.owner.id);
      bump(s.owner.id, s.priority === "MUST_FILM");
    }
    for (const a of s.assignments) {
      if (!seen.has(a.user.id)) {
        seen.add(a.user.id);
        bump(a.user.id, s.priority === "MUST_FILM");
      }
    }
    return {
      id: s.id,
      dayId: s.dayId,
      title: s.title,
      location: s.location,
      focus: s.focus,
      startTime: s.startTime,
      endTime: s.endTime,
      timeLabel: s.timeLabel,
      priority: s.priority,
      position: s.position,
      completedAt: s.completedAt,
      owner: s.owner ? crew.get(s.owner.id)! : null,
      crew: s.assignments.map((a) => ({ user: crew.get(a.user.id)!, role: a.role })),
    };
  });

  const crewLoad = [...load.entries()]
    .map(([userId, counts]) => ({ user: crew.get(userId)!, ...counts }))
    .sort((a, b) => b.sessions - a.sessions || a.user.name.localeCompare(b.user.name));

  return { dayId, sessions: rows, crewLoad };
}

/** Everyone who can be put on a session: all ACTIVE users. */
export async function listCrewCandidates(): Promise<CrewUser[]> {
  await requireUser();
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, username: true, avatarKey: true },
  });
  return Promise.all(
    users.map(async (u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      avatarUrl: await getAvatarUrl(u.avatarKey),
    })),
  );
}
