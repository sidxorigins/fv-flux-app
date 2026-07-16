import type { Label, Task, TaskStatus, User } from "@/generated/prisma/client"

/**
 * A task hydrated with the relations the board needs. Counts are optional so
 * lightweight queries (e.g. backlog rows) can reuse the shape without the
 * aggregate sub-queries.
 */
export type BoardTask = Task & {
  assignee: Pick<User, "id" | "name" | "username" | "avatarKey"> | null
  labels: Label[]
  subtaskCount?: number
  commentCount?: number
  attachmentCount?: number
}

/**
 * Fired when a card is dropped. `beforeTaskId` / `afterTaskId` are the ids of
 * the cards immediately above / below the dropped card in the target column
 * (null at the top / bottom edge), so the server can compute a fractional
 * `position` with a single-row update.
 */
export type TaskMoveEvent = {
  taskId: string
  toStatus: TaskStatus
  beforeTaskId: string | null
  afterTaskId: string | null
}
