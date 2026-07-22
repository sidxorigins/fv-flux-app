// Pure "My work" urgency bucketing — no server imports, so it's unit-testable
// on its own (queries.ts re-exports these for callers).

import type { BoardTask } from "@/features/tasks/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GroupedWork<T extends BoardTask = BoardTask> {
  overdue: T[];
  today: T[];
  thisWeek: T[];
  later: T[];
  noDate: T[];
  total: number;
}

/**
 * Bucket tasks by due date relative to `now` (server-local day):
 *   overdue  — due before today
 *   today    — due today
 *   thisWeek — due within the next 7 days (after today)
 *   later    — due 8+ days out
 *   noDate   — no due date
 * Input order is preserved within each bucket. Generic over `T` (rather than
 * fixed to `BoardTask`) so callers can bucket a `BoardTask` subtype carrying
 * extra fields (e.g. the dashboard's `projectKey` for deep links) without a
 * cast.
 */
export function bucketWorkByDue<T extends BoardTask = BoardTask>(
  tasks: T[],
  now: Date = new Date(),
): GroupedWork<T> {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday.getTime() + DAY_MS);
  const startInAWeek = new Date(startToday.getTime() + 7 * DAY_MS);

  const g: GroupedWork<T> = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    noDate: [],
    total: tasks.length,
  };

  for (const t of tasks) {
    if (!t.dueDate) {
      g.noDate.push(t);
      continue;
    }
    const d = new Date(t.dueDate);
    if (d < startToday) g.overdue.push(t);
    else if (d < startTomorrow) g.today.push(t);
    else if (d < startInAWeek) g.thisWeek.push(t);
    else g.later.push(t);
  }
  return g;
}
