// Read-side queries for the admin area. Server-only: these are imported by the
// admin Server Components (pages) and re-check authorisation on every call —
// `requireAdmin()` for everything except `getProjectMembers`, which also permits
// the project's own MANAGER (delegation clause, mirrors the write actions).
//
// Each query returns plain, serialisable DTOs (dates pre-formatted to strings,
// or passed as epoch millis for values the client must render relative to "now")
// so the client table/list components stay thin and never re-derive shapes.

import { prisma } from "@/lib/db";
import { requireAdmin, requireProjectRole } from "@/lib/permissions";
import type { Prisma } from "@/generated/prisma/client";
import type { GlobalRole, ProjectRole, UserStatus } from "@/generated/prisma/enums";
import { buildTargetLabel, type AuditTargetLookups } from "./audit-target";

const PAGE_SIZE = 25;

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

// ── Users ───────────────────────────────────────────────────────────────────
export interface AdminUserRow {
  id: string;
  name: string;
  username: string;
  email: string;
  globalRole: GlobalRole;
  status: UserStatus;
  membershipCount: number;
  createdAtLabel: string;
}

export interface UsersPage {
  items: AdminUserRow[];
  nextCursor: string | null;
}

export async function searchUsers(params: {
  q?: string;
  status?: UserStatus;
  cursor?: string;
}): Promise<UsersPage> {
  await requireAdmin();

  const where: Prisma.UserWhereInput = {};
  if (params.status) where.status = params.status;
  const term = params.q?.trim();
  if (term) {
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { username: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      globalRole: true,
      status: true,
      createdAt: true,
      _count: { select: { memberships: true } },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return {
    items: page.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      globalRole: u.globalRole,
      status: u.status,
      membershipCount: u._count.memberships,
      createdAtLabel: dateFmt.format(u.createdAt),
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export interface AdminUserMembership {
  projectId: string;
  projectKey: string;
  projectName: string;
  projectRole: ProjectRole;
  grantedAtLabel: string;
}

export interface AdminUserDetail {
  id: string;
  name: string;
  username: string;
  email: string;
  bio: string | null;
  globalRole: GlobalRole;
  status: UserStatus;
  createdAtLabel: string;
  memberships: AdminUserMembership[];
}

export async function getUser(userId: string): Promise<AdminUserDetail | null> {
  await requireAdmin();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      bio: true,
      globalRole: true,
      status: true,
      createdAt: true,
      memberships: {
        orderBy: { createdAt: "desc" },
        select: {
          projectRole: true,
          createdAt: true,
          project: { select: { id: true, key: true, name: true } },
        },
      },
    },
  });
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    bio: user.bio,
    globalRole: user.globalRole,
    status: user.status,
    createdAtLabel: dateFmt.format(user.createdAt),
    memberships: user.memberships.map((m) => ({
      projectId: m.project.id,
      projectKey: m.project.key,
      projectName: m.project.name,
      projectRole: m.projectRole,
      grantedAtLabel: dateFmt.format(m.createdAt),
    })),
  };
}

/** Minimal user list for the "add member" combobox (excludes suspended). */
export interface AssignableUser {
  id: string;
  name: string;
  username: string;
  email: string;
  status: UserStatus;
}

export async function listAssignableUsers(): Promise<AssignableUser[]> {
  await requireAdmin();
  const users = await prisma.user.findMany({
    where: { status: { not: "SUSPENDED" } },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, username: true, email: true, status: true },
  });
  return users;
}

/**
 * Assignable users for a project's MANAGER to add — same shape as
 * `listAssignableUsers` but scoped to a project the caller manages (delegation:
 * a project MANAGER, or a global Admin, may list users to grant access).
 */
export async function listAssignableUsersForProject(
  projectId: string,
): Promise<AssignableUser[]> {
  await requireProjectRole(projectId, "MANAGER");
  return prisma.user.findMany({
    where: { status: { not: "SUSPENDED" } },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, username: true, email: true, status: true },
  });
}

// ── Invites ─────────────────────────────────────────────────────────────────
export interface AdminInviteRow {
  id: string;
  email: string;
  intendedGlobalRole: GlobalRole;
  invitedByName: string;
  createdAtLabel: string;
  expiresAtMs: number;
}

export async function getPendingInvites(): Promise<AdminInviteRow[]> {
  await requireAdmin();
  const invites = await prisma.invite.findMany({
    where: { acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      intendedGlobalRole: true,
      createdAt: true,
      expiresAt: true,
      invitedBy: { select: { name: true } },
    },
  });
  return invites.map((i) => ({
    id: i.id,
    email: i.email,
    intendedGlobalRole: i.intendedGlobalRole,
    invitedByName: i.invitedBy.name,
    createdAtLabel: dateFmt.format(i.createdAt),
    expiresAtMs: i.expiresAt.getTime(),
  }));
}

// ── Projects ────────────────────────────────────────────────────────────────
export interface AdminProjectRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  leadName: string;
  memberCount: number;
  taskCount: number;
}

export async function getProjects(): Promise<AdminProjectRow[]> {
  await requireAdmin();
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      lead: { select: { name: true } },
      _count: { select: { memberships: true, tasks: true } },
    },
  });
  return projects.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    leadName: p.lead.name,
    memberCount: p._count.memberships,
    taskCount: p._count.tasks,
  }));
}

export interface AdminProjectMember {
  userId: string;
  name: string;
  username: string;
  email: string;
  status: UserStatus;
  projectRole: ProjectRole;
  grantedAtLabel: string;
}

export interface AdminProjectMembers {
  project: { id: string; key: string; name: string; description: string | null; leadName: string };
  members: AdminProjectMember[];
}

/**
 * Members of a project. Authorised for a global Admin OR the project's own
 * MANAGER (delegation clause) — the only query not gated to admins alone.
 */
export async function getProjectMembers(
  projectId: string,
): Promise<AdminProjectMembers | null> {
  await requireProjectRole(projectId, "MANAGER");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      lead: { select: { name: true } },
    },
  });
  if (!project) return null;

  const members = await prisma.projectMembership.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      projectRole: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          status: true,
        },
      },
    },
  });

  return {
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
      description: project.description,
      leadName: project.lead.name,
    },
    members: members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      username: m.user.username,
      email: m.user.email,
      status: m.user.status,
      projectRole: m.projectRole,
      grantedAtLabel: dateFmt.format(m.createdAt),
    })),
  };
}

// ── Teams (Teams Org Foundation) ───────────────────────────────────────────
export interface AdminTeamRow {
  id: string;
  name: string;
  isActive: boolean;
  managerName: string | null;
  memberCount: number;
  projectCount: number;
}

export async function getTeams(): Promise<AdminTeamRow[]> {
  await requireAdmin();
  const teams = await prisma.team.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      isActive: true,
      manager: { select: { name: true } },
      _count: { select: { members: true, projects: true } },
    },
  });
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    isActive: t.isActive,
    managerName: t.manager?.name ?? null,
    memberCount: t._count.members,
    projectCount: t._count.projects,
  }));
}

export interface AdminTeamMember {
  userId: string;
  name: string;
  username: string;
}

export interface AdminTeamProject {
  projectId: string;
  key: string;
  name: string;
  role: ProjectRole;
  leads: string[];
}

export interface AdminTeamDetail {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  managerId: string | null;
  managerName: string | null;
  members: AdminTeamMember[];
  projects: AdminTeamProject[];
}

export async function getTeam(teamId: string): Promise<AdminTeamDetail | null> {
  await requireAdmin();

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      managerId: true,
      manager: { select: { name: true } },
      members: {
        orderBy: { createdAt: "asc" },
        select: {
          user: { select: { id: true, name: true, username: true } },
        },
      },
      projects: {
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          project: {
            select: {
              id: true,
              key: true,
              name: true,
              lead: { select: { name: true } },
              additionalLeads: { select: { user: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  if (!team) return null;

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    isActive: team.isActive,
    managerId: team.managerId,
    managerName: team.manager?.name ?? null,
    members: team.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      username: m.user.username,
    })),
    projects: team.projects.map((tp) => ({
      projectId: tp.project.id,
      key: tp.project.key,
      name: tp.project.name,
      role: tp.role,
      leads: [
        tp.project.lead.name,
        ...tp.project.additionalLeads.map((l) => l.user.name),
      ],
    })),
  };
}

// ── Audit log ───────────────────────────────────────────────────────────────
export interface AdminAuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  actorName: string;
  actorUsername: string;
  metadata: unknown;
  createdAtLabel: string;
}

export interface AuditPage {
  items: AdminAuditRow[];
  nextCursor: string | null;
}

export async function getAuditLog(params: {
  cursor?: string;
  actorId?: string;
  action?: string;
}): Promise<AuditPage> {
  await requireAdmin();

  const where: Prisma.AuditLogWhereInput = {};
  if (params.actorId) where.actorId = params.actorId;
  const action = params.action?.trim();
  if (action) where.action = { contains: action, mode: "insensitive" };

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true, username: true } },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Group target ids by type, then one query per present type (no N+1).
  const idsByType = new Map<string, Set<string>>();
  for (const r of page) {
    const set = idsByType.get(r.targetType) ?? new Set<string>();
    set.add(r.targetId);
    idsByType.set(r.targetType, set);
  }
  const idsFor = (t: string) => [...(idsByType.get(t) ?? [])];

  const [users, projects, tasks, invites, memberships] = await Promise.all([
    idsFor("User").length
      ? prisma.user.findMany({
          where: { id: { in: idsFor("User") } },
          select: { id: true, name: true, username: true },
        })
      : [],
    idsFor("Project").length
      ? prisma.project.findMany({
          where: { id: { in: idsFor("Project") } },
          select: { id: true, key: true, name: true },
        })
      : [],
    idsFor("Task").length
      ? prisma.task.findMany({
          where: { id: { in: idsFor("Task") } },
          select: { id: true, key: true },
        })
      : [],
    idsFor("Invite").length
      ? prisma.invite.findMany({
          where: { id: { in: idsFor("Invite") } },
          select: { id: true, email: true },
        })
      : [],
    idsFor("ProjectMembership").length
      ? prisma.projectMembership.findMany({
          where: { id: { in: idsFor("ProjectMembership") } },
          select: {
            id: true,
            user: { select: { name: true, username: true } },
            project: { select: { key: true } },
          },
        })
      : [],
  ]);

  const lookups: AuditTargetLookups = {
    users: new Map(users.map((u) => [u.id, { name: u.name, username: u.username }])),
    projects: new Map(projects.map((p) => [p.id, { key: p.key, name: p.name }])),
    tasks: new Map(tasks.map((t) => [t.id, { key: t.key }])),
    invites: new Map(invites.map((i) => [i.id, { email: i.email }])),
    memberships: new Map(
      memberships.map((m) => [
        m.id,
        {
          userName: m.user.name,
          username: m.user.username,
          projectKey: m.project.key,
        },
      ]),
    ),
  };

  return {
    items: page.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      targetLabel: buildTargetLabel(r.targetType, r.targetId, lookups),
      actorName: r.actor.name,
      actorUsername: r.actor.username,
      metadata: r.metadata,
      createdAtLabel: dateTimeFmt.format(r.createdAt),
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}
