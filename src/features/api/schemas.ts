import { z } from "zod";
import { TaskType, TaskStatus, TaskPriority } from "@/generated/prisma/enums";

const id = z.string().min(1);

export const apiCreateTaskSchema = z.object({
  projectId: id,
  title: z.string().trim().min(1).max(200),
  type: z.enum(TaskType).default("TASK"),
  priority: z.enum(TaskPriority).default("MEDIUM"),
  assigneeId: id.nullable().optional(),
  description: z.string().max(50_000).optional(),
});

export const apiLogTimeSchema = z.object({
  taskId: id,
  minutes: z.number().int().min(1).max(24 * 60 * 31),
  note: z.string().max(1000).optional(),
  spentAt: z.coerce.date().optional(),
});

export const apiUpdateTaskStatusSchema = z.object({ status: z.enum(TaskStatus) });

export const apiStartTimerSchema = z.object({ taskId: id });
export const apiListTasksQuerySchema = z.object({ projectId: id });

export type ApiCreateTaskInput = z.infer<typeof apiCreateTaskSchema>;
export type ApiLogTimeInput = z.infer<typeof apiLogTimeSchema>;
