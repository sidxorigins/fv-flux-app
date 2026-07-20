import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  userId: z.string().min(1),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export type ApiKeyActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
