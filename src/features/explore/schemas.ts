// Task Explorer filter schema — single source of truth for the filter querystring,
// reused by the client filter bar and the server query layer (features/explore/
// queries.ts + filter-where.ts). Enum values are pulled from the generated Prisma
// enums so this can never drift from the DB, mirroring features/tasks/schemas.ts.

import { z } from "zod";
import { TaskPriority, TaskStatus, TaskType } from "@/generated/prisma/enums";

const id = z.string().min(1);

/**
 * Boolean querystring flags. Coerces "true"/"1" → true and "false"/"0"/"" → false
 * (and passes real booleans through unchanged). Deliberately NOT z.coerce.boolean()
 * — that coerces via `Boolean(value)`, so the literal string "false" (a non-empty
 * string) becomes `true`, which is exactly the value a URL-driven checkbox would
 * send when explicitly unchecked.
 */
const flag = z
  .preprocess((val) => {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      if (val === "true" || val === "1") return true;
      if (val === "false" || val === "0" || val === "") return false;
    }
    return val;
  }, z.boolean())
  .optional();

export const exploreFilterSchema = z.object({
  // Org-filter scoping — each narrows the permission-accessible project set
  // (see resolveExploreProjectIds in queries.ts). Never trusted to WIDEN access.
  projectId: id.optional(),
  teamId: id.optional(),
  managerId: id.optional(),
  leadId: id.optional(),

  // Assignment.
  assigneeId: id.optional(),
  unassigned: flag,

  // Task fields.
  type: z.enum(TaskType).optional(),
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TaskPriority).optional(),
  labelId: id.optional(),

  // Date ranges (inclusive at both ends — see exploreTaskWhere).
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),

  // Derived-condition flags.
  overdue: flag,
  noEstimate: flag,
  overEstimate: flag,
});

export type ExploreFilters = z.infer<typeof exploreFilterSchema>;

/**
 * Safe-parse a querystring (URLSearchParams, or a Next.js `searchParams` record)
 * into ExploreFilters. Each field is validated INDIVIDUALLY against its own piece
 * of the schema, so one bad or unknown entry never discards the rest of the
 * filters: unknown keys and blank ("") values are dropped before validation, and
 * a value that fails its own field's schema (e.g. an unrecognised status) is
 * dropped rather than failing the whole parse.
 */
export function parseExploreFilters(
  sp: URLSearchParams | Record<string, string | string[] | undefined>,
): ExploreFilters {
  const shape = exploreFilterSchema.shape;
  const collected: Record<string, unknown> = {};

  const entries = (): [string, string][] => {
    if (sp instanceof URLSearchParams) return [...sp.entries()];
    return Object.entries(sp).flatMap(([key, value]) => {
      if (value === undefined) return [];
      const v = Array.isArray(value) ? value[0] : value;
      return v === undefined ? [] : ([[key, v]] as [string, string][]);
    });
  };

  for (const [key, value] of entries()) {
    if (!(key in shape)) continue; // unknown key → drop
    if (value.trim() === "") continue; // blank value → drop
    const fieldSchema = shape[key as keyof typeof shape];
    const parsed = fieldSchema.safeParse(value);
    if (parsed.success && parsed.data !== undefined) {
      collected[key] = parsed.data;
    }
  }

  // Every field above was already validated individually, so this re-parse of
  // the assembled object can only fail on a future cross-field refinement (none
  // exist today) — guarded anyway so this helper can never throw.
  const result = exploreFilterSchema.safeParse(collected);
  return result.success ? result.data : {};
}
