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

// ── Audit log ───────────────────────────────────────────────────────────────
export interface AdminAuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
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

  return {
    items: page.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      actorName: r.actor.name,
      actorUsername: r.actor.username,
      metadata: r.metadata,
      createdAtLabel: dateTimeFmt.format(r.createdAt),
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}
