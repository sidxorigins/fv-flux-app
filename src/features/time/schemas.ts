import { z } from "zod";

const id = z.string().min(1);

export const startTimerSchema = z.object({ taskId: id });
export const updateTimeEntrySchema = z.object({
  id,
  minutes: z.number().int().min(1).max(24 * 60 * 31), // sanity cap: 31 days
});
export const deleteTimeEntrySchema = z.object({ id });

export type StartTimerInput = z.infer<typeof startTimerSchema>;
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;
export type DeleteTimeEntryInput = z.infer<typeof deleteTimeEntrySchema>;
