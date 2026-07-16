// Project read queries. Server-only (they call the DB + session). Each query runs a
// permission helper from lib/permissions and lets it THROW on failure — queries are
// consumed by Server Components, where an AuthorizationError surfaces to the nearest
// error boundary. (Actions, by contrast, return a `{ ok }` union.)
//
// No N+1: open-task counts come from a filtered `_count` sub-query, never by loading
// task rows into memory.

import { prisma } from "@/lib/db";
import { canViewProject, requireUser } from "@/lib/permissions";
import type { Project } from "@/generated/prisma/client";
import type { ProjectRole } from "@/generated/prisma/enums";

const USER_BASIC = {
  id: true,
  name: true,
  username: true,
  avatarKey: true,
} as const;

/** A project the current user can see, with their effective role and its open-task count. */
export type ProjectSummary = Project & {
  role: ProjectRole;
  openTaskCount: number;
};

// "Open" = anything not yet Done. Reused by the summary count.
const OPEN_TASK_COUNT = {
  tasks: { where: { status: { not: "DONE" as const } } },
} as const;

/**
 * Projects visible to the signed-in user: their memberships' projects, or ALL
 * projects for a global Admin (bypass policy). Each row carries the user's effective
 * role and a count of not-Done tasks. Never loads task rows.
 */
export async function getMyProjects(): Promise<ProjectSummary[]> {
  const user = await requireUser();

  if (user.globalRole === "ADMIN") {
    const projects = await prisma.project.findMany({
      include: { _count: { select: OPEN_TASK_COUNT } },
      orderBy: { createdAt: "desc" },
    });
    return projects.map(({ _count, ...project }) => ({
      ...project,
      role: "MANAGER",
      openTaskCount: _count.tasks,
    }));
  }

  const memberships = await prisma.projectMembership.findMany({
    where: { userId: user.id },
    orderBy: { project: { createdAt: "desc" } },
    select: {
      projectRole: true,
      project: { include: { _count: { select: OPEN_TASK_COUNT } } },
    },
  });

  return memberships.map(({ projectRole, project }) => {
    const { _count, ...rest } = project;
    return { ...rest, role: projectRole, openTaskCount: _count.tasks };
  });
}

/** A project with its lead + members (basic user fields) and open/label counts. */
export type ProjectDetail = Awaited<ReturnType<typeof getProject>>;

/**
 * A single project the user is permitted to view, including its lead and every
 * membership (with basic user fields for rendering). Returns null if the project
 * doesn't exist (an Admin can pass the view check for a non-existent id).
 */
export async function getProject(projectId: string) {
  await canViewProject(projectId); // throws AuthorizationError if not permitted

  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      lead: { select: USER_BASIC },
      memberships: {
        include: { user: { select: USER_BASIC } },
        orderBy: { createdAt: "asc" },
      },
      _count: {
        select: {
          tasks: { where: { status: { not: "DONE" } } },
          labels: true,
        },
      },
    },
  });
}
