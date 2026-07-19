import { z } from "zod";

const id = z.string().min(1);

/** Input for addTaskWatcher / removeTaskWatcher. */
export const watcherActionSchema = z.object({
  taskId: id,
  userId: id,
});

export type WatcherActionInput = z.infer<typeof watcherActionSchema>;
