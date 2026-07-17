// Pure "My work" urgency bucketing — no server imports, so it's unit-testable
// on its own (queries.ts re-exports these for callers).

import type { BoardTask } from "@/features/tasks/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GroupedWork {
  overdue: BoardTask[];
  today: BoardTask[];
  thisWeek: BoardTask[];
  later: BoardTask[];
  noDate: BoardTask[];
  total: number;
}

/**
 * Bucket tasks by due date relative to `now` (server-local day):
 *   overdue  — due before today
 *   today    — due today
 *   thisWeek — due within the next 7 days (after today)
 *   later    — due 8+ days out
 *   noDate   — no due date
 * Input order is preserved within each bucket.
 */
export function bucketWorkByDue(
  tasks: BoardTask[],
  now: Date = new Date(),
): GroupedWork {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday.getTime() + DAY_MS);
  const startInAWeek = new Date(startToday.getTime() + 7 * DAY_MS);

  const g: GroupedWork = {
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
