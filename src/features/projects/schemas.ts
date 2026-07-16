// Project Zod schemas — the single source of truth reused on client (react-hook-form
// resolvers) and server (every Server Action). Never re-validate ad hoc.

import { z } from "zod";

/**
 * Project key: 2–6 chars, starts with a letter, then letters/digits only, stored
 * uppercase. Input is uppercased BEFORE validation so mixed-case input normalises
 * rather than being rejected. Backs the `<KEY>-<n>` task-key generator, so it must
 * be short and URL/identifier-safe.
 */
export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Key must be at least 2 characters")
  .max(6, "Key must be at most 6 characters")
  .regex(
    /^[A-Z][A-Z0-9]*$/,
    "Key must start with a letter and contain only A–Z and 0–9",
  );

export const createProjectSchema = z.object({
  key: projectKeySchema,
  name: z.string().trim().min(1, "Name is required").max(80),
  // Optional free-text; empty/omitted both allowed (0–500 chars).
  description: z.string().trim().max(500).optional(),
  // Defaults to the creator when omitted (resolved server-side).
  leadId: z.string().min(1).optional(),
});

/**
 * Partial update. The project `key` is immutable in v1 (it is baked into every
 * task key already generated) so it is deliberately absent. `description` is
 * nullable so it can be explicitly cleared.
 */
export const updateProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  leadId: z.string().min(1).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
