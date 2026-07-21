import type { Prisma } from "@/generated/prisma/client";
import type { ProjectRole } from "@/generated/prisma/enums";
import { PROJECT_ROLE_ORDER } from "@/lib/permissions";

type Tx = Prisma.TransactionClient;

/** Highest role by PROJECT_ROLE_ORDER, or null for an empty list. */
export function maxRole(roles: ProjectRole[]): ProjectRole | null {
  let best: ProjectRole | null = null;
  for (const r of roles) {
    if (best === null || PROJECT_ROLE_ORDER[r] > PROJECT_ROLE_ORDER[best]) best = r;
  }
  return best;
}

/**
 * Recompute the effective ProjectMembership for one (project, user) from all
 * access sources: the row's own manualRole, team-member roles (TeamProject.role
 * for active teams the user is a member of), MANAGER if they manage such a team,
 * and MANAGER if they are a lead of the project. Writes or deletes the row so
 * lib/permissions.ts (which reads projectRole) sees the correct effective role.
 */
export async function recomputeMembership(
  tx: Tx,
  projectId: string,
  userId: string,
): Promise<void> {
  const existing = await tx.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { manualRole: true },
  });

  const sources: ProjectRole[] = [];
  if (existing?.manualRole) sources.push(existing.manualRole);

  // Team assignments for this project where the user is a member (active teams only).
  const teamProjects = await tx.teamProject.findMany({
    where: { projectId, team: { isActive: true } },
    select: { role: true, teamId: true, team: { select: { managerId: true } } },
  });
  if (teamProjects.length > 0) {
    const teamIds = teamProjects.map((t) => t.teamId);
    const memberships = await tx.teamMembership.findMany({
      where: { userId, teamId: { in: teamIds } },
      select: { teamId: true },
    });
    const memberTeamIds = new Set(memberships.map((m) => m.teamId));
    for (const tp of teamProjects) {
      if (memberTeamIds.has(tp.teamId)) sources.push(tp.role);
      if (tp.team.managerId === userId) sources.push("MANAGER");
    }
  }

  // Lead of the project? (primary leadId OR a ProjectLead row.)
  const [project, leadRow] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId }, select: { leadId: true } }),
    tx.projectLead.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true },
    }),
  ]);
  if (project?.leadId === userId || leadRow) sources.push("MANAGER");

  const role = maxRole(sources);
  if (role === null) {
    if (existing) {
      await tx.projectMembership.delete({
        where: { projectId_userId: { projectId, userId } },
      });
    }
    return;
  }
  await tx.projectMembership.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: { projectRole: role },
    create: { projectId, userId, projectRole: role, manualRole: null },
  });
}

/** Recompute every (member|manager) × project pair implied by a team. */
export async function recomputeForTeam(tx: Tx, teamId: string): Promise<void> {
  const team = await tx.team.findUnique({
    where: { id: teamId },
    select: {
      managerId: true,
      members: { select: { userId: true } },
      projects: { select: { projectId: true } },
    },
  });
  if (!team) return;
  const userIds = new Set(team.members.map((m) => m.userId));
  if (team.managerId) userIds.add(team.managerId);
  for (const { projectId } of team.projects) {
    for (const userId of userIds) {
      await recomputeMembership(tx, projectId, userId);
    }
  }
}

/** Recompute every user that could derive access to a project (leads + all teams' people). */
export async function recomputeForProject(tx: Tx, projectId: string): Promise<void> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      leadId: true,
      additionalLeads: { select: { userId: true } },
      teams: {
        select: {
          team: {
            select: { managerId: true, members: { select: { userId: true } } },
          },
        },
      },
      memberships: { select: { userId: true } },
    },
  });
  if (!project) return;
  const userIds = new Set<string>();
  userIds.add(project.leadId);
  project.additionalLeads.forEach((l) => userIds.add(l.userId));
  project.memberships.forEach((m) => userIds.add(m.userId));
  for (const tp of project.teams) {
    if (tp.team.managerId) userIds.add(tp.team.managerId);
    tp.team.members.forEach((m) => userIds.add(m.userId));
  }
  for (const userId of userIds) {
    await recomputeMembership(tx, projectId, userId);
  }
}
