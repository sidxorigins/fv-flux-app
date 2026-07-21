// Pure manager-dashboard shaping helpers — no server imports, so they're
// unit-testable on their own (queries.ts imports these; see shape.test.ts).

export type CompletionBucket = "on_time" | "late" | "no_due";

/** Bucket a task's completion vs its due date. Late iff both are present and
 * the completion timestamp is strictly after the due date. */
export function bucketCompletion(
  dueDate: Date | null,
  completedAt: Date | null,
): CompletionBucket {
  if (!dueDate || !completedAt) return "no_due";
  return completedAt.getTime() > dueDate.getTime() ? "late" : "on_time";
}

/** Hours remaining on a task: max(0, estimated - actual). 0 when no estimate. */
export function remainingHours(estimated: number | null, actual: number): number {
  if (estimated == null) return 0;
  return Math.max(0, estimated - actual);
}

/** True iff both estimated and actual are present and actual exceeds estimated. */
export function isOverEstimate(estimated: number | null, actual: number): boolean {
  return estimated != null && actual > estimated;
}
