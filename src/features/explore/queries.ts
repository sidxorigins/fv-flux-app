// Task Explorer read queries. Server-only (DB + session), consumed by the /explore
// Server Component — permission failures THROW to the nearest error boundary,
// matching the convention in features/dashboard|manager|tasks/queries.ts.
//
// SCOPING (deliberate, documented): resolveAccessibleProjectIds() is the SAME
// membership-or-admin-all resolution as features/dashboard/queries.ts#getDashboardScope
// — memberships for a regular user, every project for a global Admin. Every org
// filter (team/manager/lead/project) then INTERSECTS that accessible set — it only
// ever narrows, never widens, so a client can't smuggle in a team/manager/lead id
// to see projects outside their access. See resolveExploreProjectIds.
//
// EMPTY-SCOPE GUARD: getExploreTasks and getExploreFilterOptions both short-circuit
// to an empty result the moment the resolved project set is empty — never a Prisma
// `{ in: [] }` query, which (unlike `{ in: [x, y] }`) does not mean "match nothing"
// on every clause shape and is easy to get wrong; explicit early-return is safer.
//
// OVER-ESTIMATE: `estimatedHours` lives on Task but "actual hours" is a derived sum
// over TimeEntry, so it can't be expressed as a single Prisma `where` clause. It's a
// bounded two-step pre-pass instead: find candidate tasks (already scoped + filtered,
// estimatedHours not null), sum their TimeEntry minutes with one groupBy, keep the
// ids where actual > estimated, then AND that id list into the real query. Reuses
// features/manager/shape.ts#isOverEstimate so the "over estimate" definition can't
// drift between the manager dashboard and the Explorer.

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { isOverEstimate } from "@/features/manager/shape";
import { exploreTaskWhere } from "./filter-where";
import type { ExploreFilters } from "./schemas";
import type { Prisma, User } from "@/generated/prisma/client";
import type { TaskPriority, TaskStatus } from "@/generated/prisma/enums";

const USER_BASIC = {
  id: true,
  name: true,
  username: true,
  avatarKey: true,
} as const;

type UserBasic = Pick<User, "id" | "name" | "username" | "avatarKey">;

/** Intersection of two id sets (order-independent). */
function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const id of a) if (b.has(id)) out.add(id);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────────────────────────────────────

export interface AccessibleProjects {
  /** Ids of projects the user may see: memberships, or — for a global Admin — every project. */
  ids: string[];
  isAdmin: boolean;
}

/** Resolve the session user's permission-accessible project ids. Mirrors
 * features/dashboard/queries.ts#getDashboardScope, but widened for a global Admin
 * (the Explorer is a cross-project search tool, not the personal dashboard — an
 * Admin exploring should see every project, matching the admin-bypass policy in
 * lib/permissions). */
export async function resolveAccessibleProjectIds(): Promise<AccessibleProjects> {
  const user = await requireUser();

  if (user.globalRole === "ADMIN") {
    const projects = await prisma.project.findMany({ select: { id: true } });
    return { ids: projects.map((p) => p.id), isAdmin: true };
  }

  const memberships = await prisma.projectMembership.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  return { ids: memberships.map((m) => m.projectId), isAdmin: false };
}

/**
 * Narrow `accessible` by each org-scope filter present (projectId, teamId,
 * managerId, leadId), intersecting — never unioning — so multiple org filters
 * combine as AND and none of them can widen past `accessible`. Short-circuits the
 * moment the running set is empty so later filters skip their DB round-trip.
 */
export async function resolveExploreProjectIds(
  filters: ExploreFilters,
  accessible: string[],
): Promise<string[]> {
  let ids = new Set(accessible);
  if (ids.size === 0) return [];

  if (filters.projectId) {
    ids = intersect(ids, new Set([filters.projectId]));
  }

  if (ids.size > 0 && filters.teamId) {
    const rows = await prisma.teamProject.findMany({
      where: { teamId: filters.teamId },
      select: { projectId: true },
    });
    ids = intersect(ids, new Set(rows.map((r) => r.projectId)));
  }

  if (ids.size > 0 && filters.managerId) {
    const rows = await prisma.teamProject.findMany({
      where: { team: { managerId: filters.managerId } },
      select: { projectId: true },
    });
    ids = intersect(ids, new Set(rows.map((r) => r.projectId)));
  }

  if (ids.size > 0 && filters.leadId) {
    const rows = await prisma.project.findMany({
      where: {
        OR: [
          { leadId: filters.leadId },
          { additionalLeads: { some: { userId: filters.leadId } } },
        ],
      },
      select: { id: true },
    });
    ids = intersect(ids, new Set(rows.map((r) => r.id)));
  }

  return [...ids];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasks (filtered, paginated)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExploreTaskRow {
  id: string;
  key: string;
  title: string;
  projectId: string;
  projectKey: string;
  assignee: UserBasic | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  estimatedHours: number | null;
  labels: { id: string; name: string; color: string }[];
}

export interface ExploreTasksPage {
  tasks: ExploreTaskRow[];
  total: number;
  page: number;
  pageSize: number;
}

const EXPLORE_TASK_INCLUDE = {
  project: { select: { key: true } },
  assignee: { select: USER_BASIC },
  labels: true,
} satisfies Prisma.TaskInclude;

type ExploreTaskRowRaw = Prisma.TaskGetPayload<{ include: typeof EXPLORE_TASK_INCLUDE }>;

function toExploreTaskRow(row: ExploreTaskRowRaw): ExploreTaskRow {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    projectId: row.projectId,
    projectKey: row.project.key,
    assignee: row.assignee,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    estimatedHours: row.estimatedHours,
    labels: row.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
  };
}

function emptyPage(page: number, pageSize: number): ExploreTasksPage {
  return { tasks: [], total: 0, page, pageSize };
}

/**
 * One page of the Explorer's task list: resolve scope → resolve org-filtered
 * project set → build the where clause → (optional) over-estimate pre-pass →
 * findMany + count. Ordered by `updatedAt desc` (most recently touched first),
 * matching the default the dashboard/backlog fall back to when no explicit sort
 * is requested.
 */
export async function getExploreTasks(
  filters: ExploreFilters,
  page: number,
  pageSize = 25,
): Promise<ExploreTasksPage> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.min(Math.max(Math.floor(pageSize) || 25, 1), 100);

  const { ids: accessible } = await resolveAccessibleProjectIds();
  if (accessible.length === 0) return emptyPage(safePage, safePageSize);

  const projectIds = await resolveExploreProjectIds(filters, accessible);
  if (projectIds.length === 0) return emptyPage(safePage, safePageSize);

  const now = new Date();
  let where = exploreTaskWhere(filters, projectIds, now);

  if (filters.overEstimate) {
    const candidates = await prisma.task.findMany({
      where: { ...where, estimatedHours: { not: null } },
      select: { id: true, estimatedHours: true },
    });
    if (candidates.length === 0) return emptyPage(safePage, safePageSize);

    const sums = await prisma.timeEntry.groupBy({
      by: ["taskId"],
      where: {
        taskId: { in: candidates.map((c) => c.id) },
        minutes: { not: null },
      },
      _sum: { minutes: true },
    });
    const actualHoursByTask = new Map(
      sums.map((s) => [s.taskId, (s._sum.minutes ?? 0) / 60]),
    );

    const matchingIds = candidates
      .filter((c) => isOverEstimate(c.estimatedHours, actualHoursByTask.get(c.id) ?? 0))
      .map((c) => c.id);

    if (matchingIds.length === 0) return emptyPage(safePage, safePageSize);
    where = { AND: [where, { id: { in: matchingIds } }] };
  }

  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: EXPLORE_TASK_INCLUDE,
      orderBy: [{ updatedAt: "desc" }],
      take: safePageSize,
      skip: (safePage - 1) * safePageSize,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    tasks: rows.map(toExploreTaskRow),
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter options
// ─────────────────────────────────────────────────────────────────────────────

export interface ExploreOptions {
  projects: { id: string; key: string; name: string }[];
  teams: { id: string; name: string }[];
  managers: { id: string; name: string }[];
  leads: { id: string; name: string }[];
  assignees: { id: string; name: string; username: string }[];
  labels: { id: string; name: string; color: string }[];
}

const EMPTY_OPTIONS: ExploreOptions = {
  projects: [],
  teams: [],
  managers: [],
  leads: [],
  assignees: [],
  labels: [],
};

function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every value the Explorer's filter bar can offer, scoped to the session user's
 * accessible projects — never the whole company's teams/users. Five narrow
 * queries, deduped in memory (a project's team can repeat across projects, a user
 * can be a member of several accessible projects, etc.).
 */
export async function getExploreFilterOptions(): Promise<ExploreOptions> {
  const { ids } = await resolveAccessibleProjectIds();
  if (ids.length === 0) return EMPTY_OPTIONS;

  const [projects, teamProjects, projectLeads, memberships, labels] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: ids } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        key: true,
        name: true,
        lead: { select: { id: true, name: true } },
      },
    }),
    prisma.teamProject.findMany({
      where: { projectId: { in: ids }, team: { isActive: true } },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            manager: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.projectLead.findMany({
      where: { projectId: { in: ids } },
      select: { user: { select: { id: true, name: true } } },
    }),
    prisma.projectMembership.findMany({
      where: { projectId: { in: ids } },
      select: { user: { select: { id: true, name: true, username: true } } },
    }),
    prisma.label.findMany({
      where: { projectId: { in: ids } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
  ]);

  const teamsById = new Map<string, { id: string; name: string }>();
  const managersById = new Map<string, { id: string; name: string }>();
  for (const { team } of teamProjects) {
    teamsById.set(team.id, { id: team.id, name: team.name });
    if (team.manager) managersById.set(team.manager.id, team.manager);
  }

  const leadsById = new Map<string, { id: string; name: string }>();
  for (const p of projects) leadsById.set(p.lead.id, p.lead);
  for (const { user } of projectLeads) leadsById.set(user.id, user);

  const assigneesById = new Map<string, { id: string; name: string; username: string }>();
  for (const { user } of memberships) assigneesById.set(user.id, user);

  return {
    projects: projects.map((p) => ({ id: p.id, key: p.key, name: p.name })),
    teams: sortByName([...teamsById.values()]),
    managers: sortByName([...managersById.values()]),
    leads: sortByName([...leadsById.values()]),
    assignees: sortByName([...assigneesById.values()]),
    labels,
  };
}
