// Task / label Zod schemas — single source of truth reused on client and server.
// The enum values are pulled from the generated Prisma enums so the schemas can never
// drift from the DB.

import { z } from "zod";
import { TaskType, TaskStatus, TaskPriority } from "@/generated/prisma/enums";

const id = z.string().min(1);

// Description / comment bodies are rich-text HTML. They are ACCEPTED loosely here and
// sanitised server-side via lib/sanitize before persisting — never trust this string.
const richText = z.string().max(50_000);

export const createTaskSchema = z.object({
  projectId: id,
  title: z.string().trim().min(1, "Title is required").max(200),
  description: richText.optional(),
  type: z.enum(TaskType).default("TASK"),
  priority: z.enum(TaskPriority).default("MEDIUM"),
  assigneeId: id.nullable().optional(),
  // A subtask's parent — validated server-side to be a top-level task in the same
  // project (one level of nesting only in v1).
  parentId: id.nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  labelIds: z.array(id).optional(),
});

/**
 * Partial update keyed by taskId. `key`, `projectId`, and `parentId` are intentionally
 * NOT editable in v1: keys are immutable, tasks don't move between projects, and
 * re-parenting (which would change board membership and risk cycles) is out of scope.
 */
export const updateTaskSchema = z.object({
  taskId: id,
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  description: richText.nullable().optional(),
  type: z.enum(TaskType).optional(),
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TaskPriority).optional(),
  assigneeId: id.nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  labelIds: z.array(id).optional(),
});

/** Matches the `TaskMoveEvent` shape emitted by the board (see tasks/types.ts). */
export const moveTaskSchema = z.object({
  taskId: id,
  toStatus: z.enum(TaskStatus),
  beforeTaskId: id.nullable(),
  afterTaskId: id.nullable(),
});

/** Inline quick status change (dashboard / backlog rows). */
export const updateTaskStatusSchema = z.object({
  taskId: id,
  status: z.enum(TaskStatus),
});

export const deleteTaskSchema = z.object({ taskId: id });

// ── Labels ───────────────────────────────────────────────────────────────────

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Colour must be a hex value like #FF6B35");

export const createLabelSchema = z.object({
  projectId: id,
  name: z.string().trim().min(1, "Name is required").max(40),
  color: hexColor,
});

export const updateLabelSchema = z.object({
  labelId: id,
  name: z.string().trim().min(1, "Name is required").max(40).optional(),
  color: hexColor.optional(),
});

export const deleteLabelSchema = z.object({ labelId: id });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type CreateLabelInput = z.infer<typeof createLabelSchema>;
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;
