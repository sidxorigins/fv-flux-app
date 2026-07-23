// Pure helper (server- and client-safe — no "use client", no server imports):
// collapses CONSECUTIVE activity rows by the same actor doing the same thing to
// the same task into one row with a count, so "renamed FLUX-5" ×6 renders once.

import type { DashboardActivity } from "./queries";

export type DedupedActivity = DashboardActivity & { count: number };

function dedupeKey(a: DashboardActivity): string {
  return `${a.actor.id}|${a.action}|${a.field ?? ""}|${a.task.id}`;
}

/** Items arrive newest-first; the kept row is the newest of each run. */
export function dedupeActivity(items: DashboardActivity[]): DedupedActivity[] {
  const out: DedupedActivity[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (prev && dedupeKey(prev) === dedupeKey(item)) {
      prev.count += 1;
    } else {
      out.push({ ...item, count: 1 });
    }
  }
  return out;
}
