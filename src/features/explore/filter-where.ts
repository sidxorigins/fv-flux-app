// Pure where-builder for the Task Explorer. Called by features/explore/queries.ts
// AFTER permission scoping has already resolved the accessible project id set
// (resolveAccessibleProjectIds → resolveExploreProjectIds) — this function does no
// access control of its own, it only turns filter values into Prisma clauses.
//
// PURE: only imports the Prisma *type* namespace (erased at compile time, zero
// runtime dependency on the DB), so it's testable with plain objects — mirrors the
// pure-helper convention in features/manager/shape.ts, and the where-builder style
// of features/tasks/queries.ts#taskFilterWhere.

import type { Prisma } from "@/generated/prisma/client";
import type { ExploreFilters } from "./schemas";

/**
 * Build the Task.findMany `where` for one page of Explorer results.
 *
 * Combination rules (so filters never silently clobber one another):
 *  - `unassigned` and `assigneeId` both target `assigneeId`; `unassigned` wins if
 *    a caller somehow sets both (the filter bar only ever offers one at a time).
 *  - `dueFrom` / `dueTo` / `overdue` all narrow the same `dueDate` comparison, so
 *    they're merged into ONE object instead of overwriting each other.
 *  - `overdue` implies "not DONE", but an explicit `status` filter is more
 *    specific and stays authoritative — overdue only supplies its own not-DONE
 *    clause when no status was explicitly chosen.
 *  - `overEstimate` is NOT handled here: it needs a TimeEntry aggregate, which
 *    isn't pure — see the two-step pre-pass in queries.ts#getExploreTasks.
 */
export function exploreTaskWhere(
  filters: ExploreFilters,
  projectIds: string[],
  now: Date,
): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = { projectId: { in: projectIds } };

  if (filters.unassigned) {
    where.assigneeId = null;
  } else if (filters.assigneeId) {
    where.assigneeId = { in: [filters.assigneeId] };
  }

  if (filters.type) where.type = filters.type;
  if (filters.priority) where.priority = filters.priority;
  if (filters.labelId) where.labels = { some: { id: filters.labelId } };

  if (filters.status) {
    where.status = filters.status;
  } else if (filters.overdue) {
    where.status = { not: "DONE" };
  }

  if (filters.dueFrom || filters.dueTo || filters.overdue) {
    where.dueDate = {
      ...(filters.dueFrom ? { gte: filters.dueFrom } : {}),
      ...(filters.dueTo ? { lte: filters.dueTo } : {}),
      ...(filters.overdue ? { lt: now } : {}),
    };
  }

  if (filters.createdFrom || filters.createdTo) {
    where.createdAt = {
      ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
      ...(filters.createdTo ? { lte: filters.createdTo } : {}),
    };
  }

  if (filters.noEstimate) where.estimatedHours = null;

  return where;
}
