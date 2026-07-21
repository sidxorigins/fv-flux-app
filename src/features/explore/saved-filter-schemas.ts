// Saved filter Zod schemas — single source of truth reused on client and server.
// SavedFilter is the global (no projectId) analog of SavedView; see
// features/saved-views/schemas.ts for the per-project version this mirrors.

import { z } from "zod";

const idSchema = z.string().min(1);

/**
 * Name shown in the explorer's "Saved filters" control. Trimmed; 1..60 chars.
 * Unlike SavedView there's no per-(user, name) uniqueness constraint here, so
 * this is purely a display-length bound, not a DB constraint mirror.
 */
const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(60, "Name must be 60 characters or fewer");

/**
 * The explorer's URL search string (filters), bounded in length. Unlike
 * SavedView's query string, this is not transformed/stripped of a leading
 * "?" — callers pass the raw filter query string.
 */
const queryStringSchema = z.string().max(2000, "Query is too long");

export const createSavedFilterSchema = z.object({
  name: nameSchema,
  query: queryStringSchema,
});

export const deleteSavedFilterSchema = z.object({ id: idSchema });

export type CreateSavedFilterInput = z.infer<typeof createSavedFilterSchema>;
export type DeleteSavedFilterInput = z.infer<typeof deleteSavedFilterSchema>;
