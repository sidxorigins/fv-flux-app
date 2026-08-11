// Pure shaping helpers for the org-wide Team Pulse wall board. No server
// imports, no "use client" — importable from either side and unit-testable
// without a database (see shape.test.ts), matching features/team/shape.ts and
// features/executive/weeks.ts.

import type { TaskPriority } from "@/generated/prisma/enums";

/** Declaration order in schema.prisma — higher index = more urgent. */
const PRIORITY_RANK: Record<TaskPriority, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  URGENT: 3,
};

/** Whole minutes elapsed between `startedAt` and `now`, floored, never negative
 * (a clock skew that puts `startedAt` in the future reads as 0, not a negative
 * duration on the wall display). */
export function elapsedMinutes(startedAt: Date, now: Date): number {
  const ms = now.getTime() - startedAt.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 60_000);
}

/** "45m", "2h 15m", "3h" — compact enough to read across an office. Hours are
 * dropped entirely under 60m, and a whole-hour value omits the minutes part. */
export function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export interface CurrentTaskCandidate {
  taskId: string;
  key: string;
  title: string;
  projectKey: string;
  priority: TaskPriority;
  dueDate: Date | null;
  /** When work on this task began — a running timer's `startedAt`, or null for
   * an IN_PROGRESS assignment with no timer ever started. */
  startedAt: Date | null;
  /** True when this candidate comes from a live (endedAt: null) TimeEntry. */
  hasRunningTimer: boolean;
}

/**
 * Which single task to show as "what they're doing right now".
 *
 * A live timer is the strongest signal of intent, so it always wins — even
 * over a higher-priority IN_PROGRESS task, because the timer says what the
 * person actually chose to work on. Only when nothing is being timed do we
 * fall back to priority, then soonest due date, then task key so the pick is
 * stable across renders (an unstable pick would make the wall board flicker
 * between two equally-ranked tasks on every 60s refresh).
 *
 * Returns null for an idle member with no candidates.
 */
export function pickCurrentTask(
  candidates: readonly CurrentTaskCandidate[],
): CurrentTaskCandidate | null {
  if (candidates.length === 0) return null;

  const timed = candidates.filter((c) => c.hasRunningTimer);
  const pool = timed.length > 0 ? timed : candidates;

  return [...pool].sort((a, b) => {
    // Among several running timers, the one started most recently is what
    // they're on now (the older one is likely a timer left running).
    if (a.hasRunningTimer && b.hasRunningTimer) {
      const at = a.startedAt?.getTime() ?? 0;
      const bt = b.startedAt?.getTime() ?? 0;
      if (at !== bt) return bt - at;
    }
    const pr = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (pr !== 0) return pr;

    // Nulls last: a task with no due date never outranks one with a deadline.
    const ad = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const bd = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;

    return a.key.localeCompare(b.key);
  })[0];
}

export interface SortablePulseCard {
  name: string;
  availability: "working" | "idle";
  overdue: number;
  activeCount: number;
}

/**
 * Wall-board ordering: the cards that deserve a glance first go first.
 * Working before idle, then most-overdue, then busiest, then name for a
 * stable tie-break. Sorts a copy — the caller's array is untouched.
 */
export function sortPulseCards<T extends SortablePulseCard>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => {
    const aw = a.availability === "working" ? 1 : 0;
    const bw = b.availability === "working" ? 1 : 0;
    if (aw !== bw) return bw - aw;
    if (a.overdue !== b.overdue) return b.overdue - a.overdue;
    if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
    return a.name.localeCompare(b.name);
  });
}
