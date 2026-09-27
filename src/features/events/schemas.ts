import { z } from "zod";

// Shared Zod schemas for event schedules — single source of truth for both the
// client forms and the server actions (CLAUDE.md "Forms & validation").

const id = z.string().min(1);

/** "HH:MM" 24-hour clock. Empty string is normalised to null by the forms. */
export const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24h time like 09:30");

/** "YYYY-MM-DD" calendar date (no time, no zone). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-20")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Invalid date");

export const eventSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters")
  .max(40, "At most 40 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and single hyphens");

export const SESSION_PRIORITIES = ["MUST_FILM", "HIGH", "OPTIONAL"] as const;
export const sessionPriority = z.enum(SESSION_PRIORITIES);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const optionalClock = clockTime
  .or(z.literal(""))
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

// ── Events ──────────────────────────────────────────────────────────────────

export const createEventSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    slug: eventSlug,
    subtitle: optionalText(200),
    venue: optionalText(200),
    startDate: isoDate,
    endDate: isoDate,
    timezone: z.string().trim().min(1).max(64).default("UTC"),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

export const updateEventSchema = z
  .object({
    eventId: id,
    name: z.string().trim().min(2, "Name is required").max(120),
    subtitle: optionalText(200),
    venue: optionalText(200),
    timezone: z.string().trim().min(1).max(64),
  });

export const deleteEventSchema = z.object({ eventId: id });

export const setEventManagerSchema = z.object({
  eventId: id,
  userId: id,
  isManager: z.boolean(),
});

// ── Days ────────────────────────────────────────────────────────────────────

export const addDaySchema = z.object({
  eventId: id,
  date: isoDate,
  title: optionalText(120),
});

export const updateDaySchema = z.object({
  dayId: id,
  title: optionalText(120),
  notes: optionalText(2000),
});

export const deleteDaySchema = z.object({ dayId: id });

// ── Sessions ────────────────────────────────────────────────────────────────

const sessionFields = {
  title: z.string().trim().min(1, "Title is required").max(160),
  location: optionalText(80),
  focus: optionalText(2000),
  startTime: optionalClock,
  endTime: optionalClock,
  timeLabel: optionalText(40),
  priority: sessionPriority,
  ownerId: z.string().min(1).nullable().optional(),
};

const endAfterStart = (v: { startTime?: string | null; endTime?: string | null }) =>
  !v.startTime || !v.endTime || v.endTime > v.startTime || v.endTime < "06:00"; // allow past-midnight ends (After Party 21:00–01:00)

export const createSessionSchema = z
  .object({ dayId: id, ...sessionFields })
  .refine(endAfterStart, { message: "End time must be after start time", path: ["endTime"] });

export const updateSessionSchema = z
  .object({ sessionId: id, ...sessionFields })
  .refine(endAfterStart, { message: "End time must be after start time", path: ["endTime"] });

export const deleteSessionSchema = z.object({ sessionId: id });

export const moveSessionSchema = z.object({
  sessionId: id,
  direction: z.enum(["up", "down"]),
});

export const setSessionCompletedSchema = z.object({
  sessionId: id,
  completed: z.boolean(),
});

// ── Crew ────────────────────────────────────────────────────────────────────

export const upsertAssignmentSchema = z.object({
  sessionId: id,
  userId: id,
  role: optionalText(60),
});

export const removeAssignmentSchema = z.object({
  sessionId: id,
  userId: id,
});

export type CreateEventInput = z.input<typeof createEventSchema>;
export type UpdateEventInput = z.input<typeof updateEventSchema>;
export type CreateSessionInput = z.input<typeof createSessionSchema>;
export type UpdateSessionInput = z.input<typeof updateSessionSchema>;
export type UpsertAssignmentInput = z.input<typeof upsertAssignmentSchema>;

/** Convert "HH:MM" to minutes since midnight — the ordering key for timed sessions. */
export function clockToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
