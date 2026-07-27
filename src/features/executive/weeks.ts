// Week bucketing shared by the executive queries and their charts. Pure, no
// I/O, no "use client" — safe to import from either side.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** Midnight Monday of the ISO week containing `d` (server-local time). */
export function startOfIsoWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); // Mon = 0
  return date;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "23 Jun" — deterministic label for a week-start date. */
export function weekLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Split completion rows into this-week / last-week task-id SETS.
 *
 * Extracted as a pure function so the week-boundary arithmetic is unit-testable
 * without a database: `createdAt >= thisWeekStart` puts a completion landing at
 * exactly midnight Monday into THIS week, and de-duping by taskId means a task
 * bounced through Done twice in one week counts once.
 */
export function splitCompletionsByWeek(
  rows: readonly { taskId: string; createdAt: Date }[],
  thisWeekStart: Date,
): { thisWeek: Set<string>; lastWeek: Set<string> } {
  const thisWeek = new Set<string>();
  const lastWeek = new Set<string>();
  for (const row of rows) {
    (row.createdAt >= thisWeekStart ? thisWeek : lastWeek).add(row.taskId);
  }
  return { thisWeek, lastWeek };
}
