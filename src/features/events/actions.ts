"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  requireAdmin,
  requireEventEditor,
  requireUser,
} from "@/lib/permissions";
import { POSITION_STEP } from "@/features/tasks/positioning";

import { eachIsoDate, fromIsoDate } from "./dates";
import {
  addDaySchema,
  clockToMinutes,
  createEventSchema,
  createSessionSchema,
  deleteDaySchema,
  deleteEventSchema,
  deleteSessionSchema,
  moveSessionSchema,
  removeAssignmentSchema,
  setEventManagerSchema,
  setSessionCompletedSchema,
  updateDaySchema,
  updateEventSchema,
  updateSessionSchema,
  upsertAssignmentSchema,
} from "./schemas";
import { EVENT_TEMPLATES } from "./templates/expogast-2026";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function mapAuthError(err: unknown): { ok: false; error: string } | null {
  if (err instanceof AuthorizationError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return fail("You must be signed in.");
      case "SUSPENDED":
        return fail("Your account is suspended.");
      case "FORBIDDEN":
        return fail("You don't have permission to do that.");
    }
  }
  return null;
}

function revalidateEvent(slug?: string) {
  revalidatePath("/events");
  if (slug) revalidatePath(`/events/${slug}`);
  else revalidatePath("/events/[slug]", "page");
}

/** Position for a session: its start minute when timed, else after everything on the day. */
async function positionFor(
  tx: Pick<typeof prisma, "eventSession">,
  dayId: string,
  startTime: string | null | undefined,
  excludeId?: string,
): Promise<number> {
  if (startTime) return clockToMinutes(startTime);
  const last = await tx.eventSession.findFirst({
    where: { dayId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  // Untimed sessions land after the last timed one; 24h = 1440 keeps them past any clock value.
  return Math.max(last?.position ?? 0, 1440) + 1;
}

// ── Events ──────────────────────────────────────────────────────────────────

export async function createEvent(input: unknown): Promise<ActionResult<{ slug: string }>> {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  try {
    const admin = await requireAdmin();
    const d = parsed.data;
    const existing = await prisma.event.findUnique({ where: { slug: d.slug }, select: { id: true } });
    if (existing) return fail("An event with that URL handle already exists.");

    const event = await prisma.$transaction(async (tx) => {
      const ev = await tx.event.create({
        data: {
          slug: d.slug,
          name: d.name,
          subtitle: d.subtitle ?? null,
          venue: d.venue ?? null,
          startDate: fromIsoDate(d.startDate),
          endDate: fromIsoDate(d.endDate),
          timezone: d.timezone,
          createdById: admin.id,
        },
      });
      await tx.eventDay.createMany({
        data: eachIsoDate(d.startDate, d.endDate).map((iso) => ({ eventId: ev.id, date: fromIsoDate(iso) })),
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "event.created",
          targetType: "Event",
          targetId: ev.id,
          metadata: { slug: ev.slug, name: ev.name },
        },
      });
      return ev;
    });
    revalidateEvent(event.slug);
    return { ok: true, data: { slug: event.slug } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Create an event (days + sessions) from a bundled template, e.g. Expogast 2026. Admin-only. */
export async function createEventFromTemplate(
  templateSlug: string,
): Promise<ActionResult<{ slug: string }>> {
  const template = EVENT_TEMPLATES[templateSlug];
  if (!template) return fail("Unknown template.");
  try {
    const admin = await requireAdmin();
    const existing = await prisma.event.findUnique({ where: { slug: template.slug }, select: { id: true } });
    if (existing) return fail(`"${template.name}" already exists — open it from the list.`);

    await prisma.$transaction(async (tx) => {
      const ev = await tx.event.create({
        data: {
          slug: template.slug,
          name: template.name,
          subtitle: template.subtitle,
          venue: template.venue,
          startDate: fromIsoDate(template.startDate),
          endDate: fromIsoDate(template.endDate),
          timezone: template.timezone,
          createdById: admin.id,
        },
      });
      for (const day of template.days) {
        const row = await tx.eventDay.create({
          data: { eventId: ev.id, date: fromIsoDate(day.date), title: day.title, notes: day.notes ?? null },
        });
        if (day.sessions.length > 0) {
          await tx.eventSession.createMany({
            data: day.sessions.map((s, i) => ({
              eventId: ev.id,
              dayId: row.id,
              title: s.title,
              location: s.location ?? null,
              focus: s.focus ?? null,
              startTime: s.startTime ?? null,
              endTime: s.endTime ?? null,
              timeLabel: s.timeLabel ?? null,
              priority: s.priority,
              // Timed → clock minute; untimed → its anchor; tiny index tie-break keeps doc order.
              position: (s.startTime ? clockToMinutes(s.startTime) : (s.anchor ?? 1440)) + i / 1000,
            })),
          });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "event.created",
          targetType: "Event",
          targetId: ev.id,
          metadata: { slug: ev.slug, name: ev.name, template: template.slug },
        },
      });
    });
    revalidateEvent(template.slug);
    return { ok: true, data: { slug: template.slug } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

export async function updateEvent(input: unknown): Promise<ActionResult> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  try {
    await requireEventEditor(parsed.data.eventId);
    const d = parsed.data;
    const ev = await prisma.event.update({
      where: { id: d.eventId },
      data: { name: d.name, subtitle: d.subtitle ?? null, venue: d.venue ?? null, timezone: d.timezone },
      select: { slug: true },
    });
    revalidateEvent(ev.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Delete an event and (by cascade) all its days, sessions and crew. Admin-only, audited. */
export async function deleteEvent(input: unknown): Promise<ActionResult> {
  const parsed = deleteEventSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const admin = await requireAdmin();
    const ev = await prisma.event.findUnique({ where: { id: parsed.data.eventId }, select: { slug: true, name: true } });
    if (!ev) return fail("Event not found.");
    await prisma.$transaction(async (tx) => {
      await tx.event.delete({ where: { id: parsed.data.eventId } });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "event.deleted",
          targetType: "Event",
          targetId: parsed.data.eventId,
          metadata: { slug: ev.slug, name: ev.name },
        },
      });
    });
    revalidateEvent(ev.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Grant or revoke schedule-edit rights on an event. Admin-only, audited. */
export async function setEventManager(input: unknown): Promise<ActionResult> {
  const parsed = setEventManagerSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const admin = await requireAdmin();
    const { eventId, userId, isManager } = parsed.data;
    const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { slug: true } });
    if (!ev) return fail("Event not found.");
    await prisma.$transaction(async (tx) => {
      if (isManager) {
        await tx.eventManager.upsert({
          where: { eventId_userId: { eventId, userId } },
          create: { eventId, userId },
          update: {},
        });
      } else {
        await tx.eventManager.deleteMany({ where: { eventId, userId } });
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: isManager ? "event.manager_granted" : "event.manager_revoked",
          targetType: "Event",
          targetId: eventId,
          metadata: { userId },
        },
      });
    });
    revalidateEvent(ev.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

// ── Days ────────────────────────────────────────────────────────────────────

export async function addDay(input: unknown): Promise<ActionResult<{ dayId: string }>> {
  const parsed = addDaySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  try {
    await requireEventEditor(parsed.data.eventId);
    const date = fromIsoDate(parsed.data.date);
    const dup = await prisma.eventDay.findUnique({
      where: { eventId_date: { eventId: parsed.data.eventId, date } },
      select: { id: true },
    });
    if (dup) return fail("That day is already on the schedule.");

    const day = await prisma.$transaction(async (tx) => {
      const row = await tx.eventDay.create({
        data: { eventId: parsed.data.eventId, date, title: parsed.data.title ?? null },
      });
      // Keep the event's range covering every day it has.
      const ev = await tx.event.findUniqueOrThrow({
        where: { id: parsed.data.eventId },
        select: { slug: true, startDate: true, endDate: true },
      });
      await tx.event.update({
        where: { id: parsed.data.eventId },
        data: {
          startDate: date < ev.startDate ? date : ev.startDate,
          endDate: date > ev.endDate ? date : ev.endDate,
        },
      });
      return { ...row, slug: ev.slug };
    });
    revalidateEvent(day.slug);
    return { ok: true, data: { dayId: day.id } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

export async function updateDay(input: unknown): Promise<ActionResult> {
  const parsed = updateDaySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  try {
    const day = await prisma.eventDay.findUnique({
      where: { id: parsed.data.dayId },
      select: { eventId: true, event: { select: { slug: true } } },
    });
    if (!day) return fail("Day not found.");
    await requireEventEditor(day.eventId);
    await prisma.eventDay.update({
      where: { id: parsed.data.dayId },
      data: { title: parsed.data.title ?? null, notes: parsed.data.notes ?? null },
    });
    revalidateEvent(day.event.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Remove a day and every session on it. */
export async function deleteDay(input: unknown): Promise<ActionResult> {
  const parsed = deleteDaySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const day = await prisma.eventDay.findUnique({
      where: { id: parsed.data.dayId },
      select: { eventId: true, event: { select: { slug: true, _count: { select: { days: true } } } } },
    });
    if (!day) return fail("Day not found.");
    await requireEventEditor(day.eventId);
    if (day.event._count.days <= 1) return fail("An event needs at least one day.");
    await prisma.eventDay.delete({ where: { id: parsed.data.dayId } });
    revalidateEvent(day.event.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

// ── Sessions ────────────────────────────────────────────────────────────────

async function loadSessionForEdit(sessionId: string) {
  return prisma.eventSession.findUnique({
    where: { id: sessionId },
    select: { id: true, dayId: true, eventId: true, position: true, startTime: true, event: { select: { slug: true } } },
  });
}

export async function createSession(input: unknown): Promise<ActionResult<{ sessionId: string }>> {
  const parsed = createSessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  try {
    const day = await prisma.eventDay.findUnique({
      where: { id: parsed.data.dayId },
      select: { eventId: true, event: { select: { slug: true } } },
    });
    if (!day) return fail("Day not found.");
    await requireEventEditor(day.eventId);
    const d = parsed.data;
    const session = await prisma.$transaction(async (tx) => {
      const position = await positionFor(tx, d.dayId, d.startTime);
      return tx.eventSession.create({
        data: {
          eventId: day.eventId,
          dayId: d.dayId,
          title: d.title,
          location: d.location ?? null,
          focus: d.focus ?? null,
          startTime: d.startTime ?? null,
          endTime: d.endTime ?? null,
          timeLabel: d.timeLabel ?? null,
          priority: d.priority,
          ownerId: d.ownerId ?? null,
          position,
        },
        select: { id: true },
      });
    });
    revalidateEvent(day.event.slug);
    return { ok: true, data: { sessionId: session.id } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

export async function updateSession(input: unknown): Promise<ActionResult> {
  const parsed = updateSessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  try {
    const existing = await loadSessionForEdit(parsed.data.sessionId);
    if (!existing) return fail("Session not found.");
    await requireEventEditor(existing.eventId);
    const d = parsed.data;
    await prisma.$transaction(async (tx) => {
      // Re-derive ordering only when the clock time actually changed, so a
      // manually nudged untimed session keeps its place through other edits.
      const timeChanged = (d.startTime ?? null) !== existing.startTime;
      const position = timeChanged ? await positionFor(tx, existing.dayId, d.startTime, existing.id) : existing.position;
      await tx.eventSession.update({
        where: { id: existing.id },
        data: {
          title: d.title,
          location: d.location ?? null,
          focus: d.focus ?? null,
          startTime: d.startTime ?? null,
          endTime: d.endTime ?? null,
          timeLabel: d.timeLabel ?? null,
          priority: d.priority,
          ownerId: d.ownerId ?? null,
          position,
        },
      });
    });
    revalidateEvent(existing.event.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

export async function deleteSession(input: unknown): Promise<ActionResult> {
  const parsed = deleteSessionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const existing = await loadSessionForEdit(parsed.data.sessionId);
    if (!existing) return fail("Session not found.");
    await requireEventEditor(existing.eventId);
    await prisma.eventSession.delete({ where: { id: existing.id } });
    revalidateEvent(existing.event.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/**
 * Nudge a session one place up/down within its day. Fractional-index: the new
 * position is the midpoint of the two neighbours it lands between, so this is
 * a single-row update. Nudging a timed session detaches it from its clock
 * position deliberately — the user asked for a specific order.
 */
export async function moveSession(input: unknown): Promise<ActionResult> {
  const parsed = moveSessionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const existing = await loadSessionForEdit(parsed.data.sessionId);
    if (!existing) return fail("Session not found.");
    await requireEventEditor(existing.eventId);

    const siblings = await prisma.eventSession.findMany({
      where: { dayId: existing.dayId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, position: true },
    });
    const idx = siblings.findIndex((s) => s.id === existing.id);
    const target = parsed.data.direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= siblings.length) return { ok: true }; // already at the edge

    // Landing between `target` and the one beyond it (in the move direction).
    const beyond = parsed.data.direction === "up" ? target - 1 : target + 1;
    const a = siblings[target].position;
    const b = beyond >= 0 && beyond < siblings.length ? siblings[beyond].position : null;
    let position: number;
    if (b === null) position = parsed.data.direction === "up" ? a - POSITION_STEP : a + POSITION_STEP;
    else position = (a + b) / 2;

    await prisma.eventSession.update({ where: { id: existing.id }, data: { position } });
    revalidateEvent(existing.event.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/**
 * Mark a session covered / not covered. Any ACTIVE user who is the owner or on
 * the crew may do this (they're the ones holding the camera); editors always can.
 */
export async function setSessionCompleted(input: unknown): Promise<ActionResult> {
  const parsed = setSessionCompletedSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const user = await requireUser();
    const s = await prisma.eventSession.findUnique({
      where: { id: parsed.data.sessionId },
      select: {
        eventId: true,
        ownerId: true,
        event: { select: { slug: true, managers: { where: { userId: user.id }, select: { id: true } } } },
        assignments: { where: { userId: user.id }, select: { id: true } },
      },
    });
    if (!s) return fail("Session not found.");
    const allowed =
      user.globalRole === "ADMIN" ||
      s.event.managers.length > 0 ||
      s.ownerId === user.id ||
      s.assignments.length > 0;
    if (!allowed) return fail("Only the session's crew can mark it done.");
    await prisma.eventSession.update({
      where: { id: parsed.data.sessionId },
      data: { completedAt: parsed.data.completed ? new Date() : null },
    });
    revalidateEvent(s.event.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

// ── Crew ────────────────────────────────────────────────────────────────────

/** Add a person to a session (or change their role if already on it). */
export async function upsertAssignment(input: unknown): Promise<ActionResult> {
  const parsed = upsertAssignmentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  try {
    const existing = await loadSessionForEdit(parsed.data.sessionId);
    if (!existing) return fail("Session not found.");
    await requireEventEditor(existing.eventId);
    const target = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { status: true },
    });
    if (!target || target.status !== "ACTIVE") return fail("That user can't be assigned.");
    await prisma.eventSessionAssignment.upsert({
      where: { sessionId_userId: { sessionId: parsed.data.sessionId, userId: parsed.data.userId } },
      create: { sessionId: parsed.data.sessionId, userId: parsed.data.userId, role: parsed.data.role ?? null },
      update: { role: parsed.data.role ?? null },
    });
    revalidateEvent(existing.event.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

export async function removeAssignment(input: unknown): Promise<ActionResult> {
  const parsed = removeAssignmentSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  try {
    const existing = await loadSessionForEdit(parsed.data.sessionId);
    if (!existing) return fail("Session not found.");
    await requireEventEditor(existing.eventId);
    await prisma.eventSessionAssignment.deleteMany({
      where: { sessionId: parsed.data.sessionId, userId: parsed.data.userId },
    });
    revalidateEvent(existing.event.slug);
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}
