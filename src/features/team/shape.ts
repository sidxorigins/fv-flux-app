// Pure team-productivity shaping helper — no server imports, so it's
// unit-testable on its own (queries.ts imports this; see shape.test.ts).

/** Completion percentage, rounded to the nearest integer. 0 when total<=0
 * (guards div-by-zero for a member with no tasks in scope). */
export function completionPct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}
