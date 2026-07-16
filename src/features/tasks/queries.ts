// Task read queries. Server-only (DB + session). Each query runs a permission helper
// from lib/permissions and lets it THROW on failure (queries are consumed by Server
// Components → nearest error boundary). No N+1: relations come from a single shared
// `include`, and card counts come from `_count`, never by loading child rows.

import { prisma } from "@/lib/db";
import { canViewProject, requireUser } from "@/lib/permissions";
import { Prisma } from "@/generated/prisma/client";
import type { Label, Task, User } from "@/generated/prisma/client";
import type {
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/generated/prisma/enums";
import type { BoardTask } from "@/features/tasks/types";

const USER_BASIC = {
  id: true,
  name: true,
  username: true,
  avatarKey: true,
} as const;

type UserBasic = Pick<User, "id" | "name" | "username" | "avatarKey">;

/** The one include used everywhere a BoardTask is produced — keeps queries to one round-trip. */
const boardTaskInclude = {
  assignee: { select: USER_BASIC },
  labels: true,
  _count: { select: { subtasks: true, comments: true, attachments: true } },
} satisfies Prisma.TaskInclude;

type BoardTaskRow = Prisma.TaskGetPayload<{ include: typeof boardTaskInclude }>;

function toBoardTask(row: BoardTaskRow): BoardTask {
  const { _count, ...task } = row;
  return {
    ...task,
    subtaskCount: _count.subtasks,
    commentCount: _count.comments,
    attachmentCount: _count.attachments,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Board
// ─────────────────────────────────────────────────────────────────────────────

/** Top-level cards for a project's board, ordered by board position. */
export async function getBoardTasks(projectId: string): Promise<BoardTask[]> {
  await canViewProject(projectId); // throws if not permitted

  const rows = await prisma.task.findMany({
    where: { projectId, parentId: null },
    include: boardTaskInclude,
    orderBy: { position: "asc" },
  });
  return rows.map(toBoardTask);
}

// ─────────────────────────────────────────────────────────────────────────────
// Backlog (filtered + cursor-paginated)
// ─────────────────────────────────────────────────────────────────────────────

export interface BacklogFilters {
  status?: TaskStatus;
  type?: TaskType;
  priority?: TaskPriority;
  assigneeId?: string;
  labelId?: string;
  /** Free-text: case-insensitive title contains OR exact task-key match (e.g. "FLUX-42"). */
  q?: string;
  sort?: "priority" | "dueDate" | "createdAt" | "updatedAt";
  dir?: "asc" | "desc";
  /** Task id to page after (exclusive). */
  cursor?: string;
  limit?: number;
}

export interface BacklogPage {
  tasks: BoardTask[];
  nextCursor: string | null;
}

/**
 * Backlog / list view: top-level tasks in a project with filtering, search, sorting,
 * and cursor pagination. The order always ends with a unique `id` tiebreaker so the
 * cursor is stable even when the primary sort has ties.
 */
export async function getBacklogTasks(
  projectId: string,
  filters: BacklogFilters = {},
): Promise<BacklogPage> {
  await canViewProject(projectId);

  const where: Prisma.TaskWhereInput = { projectId, parentId: null };
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.labelId) where.labels = { some: { id: filters.labelId } };
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { key: { equals: q, mode: "insensitive" } },
    ];
  }

  const sort = filters.sort ?? "createdAt";
  // Sensible default direction per field: soonest due first; newest/highest otherwise.
  const dir = filters.dir ?? (sort === "dueDate" ? "asc" : "desc");

  const orderBy: Prisma.TaskOrderByWithRelationInput[] = [];
  switch (sort) {
    case "priority":
      orderBy.push({ priority: dir });
      break;
    case "dueDate":
      orderBy.push({ dueDate: { sort: dir, nulls: "last" } });
      break;
    case "updatedAt":
      orderBy.push({ updatedAt: dir });
      break;
    case "createdAt":
    default:
      orderBy.push({ createdAt: dir });
      break;
  }
  orderBy.push({ id: "asc" }); // deterministic tiebreaker for the cursor

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);

  const rows = await prisma.task.findMany({
    where,
    include: boardTaskInclude,
    orderBy,
    take: limit + 1, // fetch one extra to detect a next page
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return { tasks: page.map(toBoardTask), nextCursor };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single task detail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full task detail: description, assignee/reporter, labels, and its parent + subtasks
 * (as BoardTasks). Comments / attachments / activity are owned by other queries and
 * deliberately excluded. Returns null if the task doesn't exist.
 */
export type TaskDetail = Task & {
  assignee: UserBasic | null;
  reporter: UserBasic;
  labels: Label[];
  parent: BoardTask | null;
  subtasks: BoardTask[];
};

export async function getTask(taskId: string): Promise<TaskDetail | null> {
  const base = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!base) return null;

  await canViewProject(base.projectId); // throws if not permitted

  const row = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: { select: USER_BASIC },
      reporter: { select: USER_BASIC },
      labels: true,
      parent: { include: boardTaskInclude },
      subtasks: { include: boardTaskInclude, orderBy: { position: "asc" } },
    },
  });
  if (!row) return null;

  const { parent, subtasks, ...rest } = row;
  return {
    ...rest,
    parent: parent ? toBoardTask(parent) : null,
    subtasks: subtasks.map(toBoardTask),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// My work
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tasks assigned to the signed-in user across projects they can see, excluding Done,
 * ordered by priority (highest first) then due date (soonest first, nulls last). Powers
 * the dashboard "My work" list.
 */
export async function getMyTasks(limit = 25): Promise<BoardTask[]> {
  const user = await requireUser();
  const take = Math.min(Math.max(limit, 1), 100);

  const where: Prisma.TaskWhereInput = {
    assigneeId: user.id,
    status: { not: "DONE" },
  };
  // Non-admins only see tasks in projects they belong to (admins bypass — global view).
  if (user.globalRole !== "ADMIN") {
    where.project = { memberships: { some: { userId: user.id } } };
  }

  const rows = await prisma.task.findMany({
    where,
    include: boardTaskInclude,
    orderBy: [
      { priority: "desc" },
      { dueDate: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ],
    take,
  });
  return rows.map(toBoardTask);
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels (read)
// ─────────────────────────────────────────────────────────────────────────────

/** All labels for a project, alphabetised. Label mutations live in tasks/labels.ts. */
export async function getProjectLabels(projectId: string): Promise<Label[]> {
  await canViewProject(projectId);
  return prisma.label.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
}
