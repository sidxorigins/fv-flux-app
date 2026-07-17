// Saved view Zod schemas — single source of truth reused on client and server.

import { z } from "zod";

const idSchema = z.string().min(1);

/**
 * Name shown in the "Views" control. Trimmed; 1..40 chars — matches the
 * `@@unique([userId, projectId, name])` constraint, so re-saving under the
 * same name is a deliberate overwrite (see `createSavedView`'s upsert).
 */
const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(40, "Name must be 40 characters or fewer");

/**
 * The backlog's URL search string (filters + sort), e.g.
 * "status=TODO&priority=HIGH&sort=priority&dir=desc". Accepted loosely and
 * bounded in length; a leading "?" is stripped so callers can pass either
 * `searchParams.toString()` or `location.search`.
 */
const queryStringSchema = z
  .string()
  .trim()
  .max(2000, "Query is too long")
  .transform((value) => value.replace(/^\?+/, ""));

export const createSavedViewSchema = z.object({
  projectId: idSchema,
  name: nameSchema,
  query: queryStringSchema,
});

export const deleteSavedViewSchema = z.object({ id: idSchema });

export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;
export type DeleteSavedViewInput = z.infer<typeof deleteSavedViewSchema>;
