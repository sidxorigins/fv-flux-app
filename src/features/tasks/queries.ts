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

/** The filter subset shared by the board and the backlog (no sort/pagination). */
export interface TaskFilterSet {
  status?: TaskStatus;
  type?: TaskType;
  priority?: TaskPriority;
  assigneeId?: string;
  labelId?: string;
  /** Free-text: case-insensitive title contains OR exact task-key match. */
  q?: string;
}

/** Build the shared `where` for top-level project tasks + the common filters. */
function taskFilterWhere(
  projectId: string,
  filters: TaskFilterSet,
): Prisma.TaskWhereInput {
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
  return where;
}

/**
 * Top-level cards for a project's board, ordered by board position. Accepts the
 * same filter set as the backlog so the board's filter bar narrows the columns
 * (status stays the column axis, but filtering by it is still honoured).
 */
export async function getBoardTasks(
  projectId: string,
  filters: TaskFilterSet = {},
): Promise<BoardTask[]> {
  await canViewProject(projectId); // throws if not permitted

  const rows = await prisma.task.findMany({
    where: taskFilterWhere(projectId, filters),
    include: boardTaskInclude,
    orderBy: { position: "asc" },
  });
  return rows.map(toBoardTask);
}

// ─────────────────────────────────────────────────────────────────────────────
// Backlog (filtered + cursor-paginated)
// ─────────────────────────────────────────────────────────────────────────────

/** Columns the backlog table can be sorted by (exposed via clickable column headers). */
export const BACKLOG_SORT_FIELDS = [
  "key",
  "priority",
  "dueDate",
  "status",
  "updatedAt",
] as const;
export type BacklogSortField = (typeof BACKLOG_SORT_FIELDS)[number];

/**
 * Sensible default direction the first time a column is sorted (before the user has
 * toggled it once) — soonest due date / highest priority / earliest workflow status
 * first; alphabetical/chronological ascending otherwise. Clicking an already-active
 * column flips to the opposite direction.
 *
 * Kept in sync with the client-side copy in components/BacklogView.tsx: this module
 * wires up Prisma at load time, so a "use client" component may only import its
 * *types* (fully erased — see `isolatedModules` in tsconfig), never its runtime
 * values, and has to redeclare this map locally for the header click handler.
 */
export const BACKLOG_SORT_DEFAULT_DIR: Record<BacklogSortField, "asc" | "desc"> = {
  key: "asc",
  priority: "desc",
  dueDate: "asc",
  status: "asc",
  updatedAt: "desc",
};

export interface BacklogFilters {
  status?: TaskStatus;
  type?: TaskType;
  priority?: TaskPriority;
  assigneeId?: string;
  labelId?: string;
  /** Free-text: case-insensitive title contains OR exact task-key match (e.g. "FLUX-42"). */
  q?: string;
  sort?: BacklogSortField;
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

  const where = taskFilterWhere(projectId, filters);

  // No `sort` param → the original, unchanged default ordering: newest first.
  // `filters.sort` is whitelisted at the boundary (see page.tsx's `isSortField`),
  // so anything reaching here is already a known BacklogSortField or undefined —
  // never raw client input.
  const sort: BacklogSortField | "createdAt" = filters.sort ?? "createdAt";
  const dir: "asc" | "desc" =
    filters.dir ?? (sort === "createdAt" ? "desc" : BACKLOG_SORT_DEFAULT_DIR[sort]);

  const orderBy: Prisma.TaskOrderByWithRelationInput[] = [];
  switch (sort) {
    case "key":
      orderBy.push({ key: dir });
      break;
    case "priority":
      // TaskPriority is declared LOW < MEDIUM < HIGH < URGENT in schema.prisma, and
      // Postgres native enums order by declaration position, not alphabetically — so
      // Prisma's asc/desc on the enum column already sorts by severity: asc goes
      // LOW→URGENT, desc goes URGENT→LOW (most urgent first). No rank mapping needed.
      orderBy.push({ priority: dir });
      break;
    case "dueDate":
      orderBy.push({ dueDate: { sort: dir, nulls: "last" } });
      break;
    case "status":
      // Same native-enum reasoning as priority: TODO < IN_PROGRESS < IN_REVIEW < DONE
      // is declared in workflow order, so asc reads as "earliest stage first".
      orderBy.push({ status: dir });
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

// ─────────────────────────────────────────────────────────────────────────────
// Global search (⌘K command palette)
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchResults {
  tasks: {
    id: string;
    key: string;
    title: string;
    type: TaskType;
    status: TaskStatus;
    projectId: string;
  }[];
  projects: { id: string; key: string; name: string }[];
}

/**
 * Cross-project search for the command palette. Permission-scoped: non-admins
 * only match tasks/projects they have a membership in; admins see everything.
 * Matches task key (exact-ish, case-insensitive) or title, and project key/name.
 */
export async function searchEverything(rawQuery: string): Promise<SearchResults> {
  const user = await requireUser();
  const q = rawQuery.trim();
  if (q.length === 0) return { tasks: [], projects: [] };

  const memberOnly =
    user.globalRole === "ADMIN"
      ? {}
      : { project: { memberships: { some: { userId: user.id } } } };
  const projectScope =
    user.globalRole === "ADMIN"
      ? {}
      : { memberships: { some: { userId: user.id } } };

  const [tasks, projects] = await Promise.all([
    prisma.task.findMany({
      where: {
        ...memberOnly,
        OR: [
          { key: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        key: true,
        title: true,
        type: true,
        status: true,
        projectId: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.project.findMany({
      where: {
        ...projectScope,
        OR: [
          { key: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, key: true, name: true },
      orderBy: { name: "asc" },
      take: 5,
    }),
  ]);

  return { tasks, projects };
}
