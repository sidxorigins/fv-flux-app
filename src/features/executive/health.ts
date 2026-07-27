// The project health signal. Pure and dependency-free so it is trivially
// testable and so both the server queries and any client component can use it.

export type ProjectHealth = "ON_TRACK" | "AT_RISK" | "STALLED";

export interface HealthInputs {
  /** Tasks not in DONE. */
  open: number;
  /** Open tasks whose dueDate has passed. */
  overdue: number;
  /** Open URGENT tasks with no assignee. */
  unassignedUrgent: number;
  /** ActivityLog entries on this project's tasks in the last 14 days. */
  activity14d: number;
}

/**
 * Evaluated in order — STALLED wins over AT_RISK because total silence is the
 * more actionable signal.
 *
 *   STALLED   — activity14d === 0 && open > 0
 *   AT_RISK   — overdue > 0 || unassignedUrgent > 0
 *   ON_TRACK  — otherwise
 *
 * A week-over-week completion DECLINE was deliberately rejected as a trigger:
 * on a quiet week it would paint healthy projects amber, and a signal that
 * fires on healthy projects stops being read.
 */
export function projectHealth({
  open,
  overdue,
  unassignedUrgent,
  activity14d,
}: HealthInputs): ProjectHealth {
  if (activity14d === 0 && open > 0) return "STALLED";
  if (overdue > 0 || unassignedUrgent > 0) return "AT_RISK";
  return "ON_TRACK";
}

/** Token-mapped chip metadata — functional colours only, never orange. */
export const HEALTH_META: Record<
  ProjectHealth,
  { label: string; chipClass: string; dotClass: string }
> = {
  ON_TRACK: {
    label: "On track",
    chipClass: "bg-success/10 text-success",
    dotClass: "bg-success",
  },
  AT_RISK: {
    label: "At risk",
    chipClass: "bg-warning/10 text-warning",
    dotClass: "bg-warning",
  },
  STALLED: {
    label: "Stalled",
    chipClass: "bg-muted-foreground/10 text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
};
