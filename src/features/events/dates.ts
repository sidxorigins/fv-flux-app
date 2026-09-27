// Pure date helpers for event schedules — no I/O, unit-tested in dates.test.ts.
//
// Event dates are calendar dates stored as Postgres DATE (Prisma returns them
// as a Date at 00:00:00 UTC). Everything here therefore reads/writes the UTC
// fields so a day never shifts when the server or viewer is in another zone.

/** Date at UTC midnight → "YYYY-MM-DD". */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → Date at UTC midnight (what Prisma expects for @db.Date). */
export function fromIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Every "YYYY-MM-DD" from start to end inclusive. */
export function eachIsoDate(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const cursor = fromIsoDate(startIso);
  const end = fromIsoDate(endIso);
  while (cursor.getTime() <= end.getTime()) {
    out.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Today's calendar date in an IANA zone, as "YYYY-MM-DD". Falls back to UTC on a bad zone. */
export function todayInZone(timezone: string, now: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return toIsoDate(now);
  }
}

/**
 * Which day to open by default: today if the event is running, the first
 * day if it hasn't started, the last day if it's over. `days` must be sorted.
 */
export function pickDefaultDay<T extends { date: Date }>(days: T[], todayIso: string): T | null {
  if (days.length === 0) return null;
  const exact = days.find((d) => toIsoDate(d.date) === todayIso);
  if (exact) return exact;
  const upcoming = days.find((d) => toIsoDate(d.date) > todayIso);
  return upcoming ?? days[days.length - 1];
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Fri 20" — compact tab label. */
export function formatDayTab(date: Date): { weekday: string; day: number } {
  return { weekday: WEEKDAY_SHORT[date.getUTCDay()], day: date.getUTCDate() };
}

/** "Friday 20 November". */
export function formatDayLong(date: Date): string {
  return `${WEEKDAY_LONG[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_LONG[date.getUTCMonth()]}`;
}

/** "20–26 Nov 2026" or "28 Nov – 2 Dec 2026". */
export function formatDateRange(start: Date, end: Date): string {
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  if (toIsoDate(start) === toIsoDate(end)) {
    return `${start.getUTCDate()} ${MONTH_SHORT[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  }
  if (sameMonth) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${MONTH_SHORT[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  }
  return `${start.getUTCDate()} ${MONTH_SHORT[start.getUTCMonth()]} – ${end.getUTCDate()} ${MONTH_SHORT[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
}

/** "10:30–14:00", "10:30", or the free-text label ("Morning") / "—". */
export function formatSessionTime(s: {
  startTime: string | null;
  endTime: string | null;
  timeLabel: string | null;
}): string {
  if (s.startTime) return s.endTime ? `${s.startTime}–${s.endTime}` : s.startTime;
  return s.timeLabel ?? "—";
}
