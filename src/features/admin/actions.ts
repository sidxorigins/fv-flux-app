"use server";

// Admin Server Actions — user management, invites, and per-project access.
//
// Security (CLAUDE.md "Admin Dashboard" / "Security Requirements"):
//   - Every action re-checks authorisation on the server. Global-admin actions
//     call `requireAdmin()`; project-membership actions call
//     `requireProjectRole(projectId, "MANAGER")` so a global Admin OR the
//     project's own MANAGER may run them (the delegation clause) — never trust a
//     hidden nav link or the proxy alone.
//   - Every mutation validates input with a Zod schema before touching the DB.
//   - Every mutation writes an AuditLog row (actor + target + metadata) inside
//     the same transaction as the change, so the trail can't drift from reality.
//
// Result convention: `{ ok: true, data? } | { ok: false, error }`.

import { revalidatePath } from "next/cache";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { recomputeForTeam, recomputeMembership } from "@/lib/access-sync";
import {
  AuthorizationError,
  requireAdmin,
  requireProjectRole,
  requireTeamManage,
} from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { sendInviteEmail } from "@/lib/mail";
import { generateInviteToken, hashToken } from "@/lib/tokens";

import {
  assignTeamManagerSchema,
  changeGlobalRoleSchema,
  createTeamSchema,
  createUserSchema,
  inviteIdSchema,
  membershipSchema,
  projectLeadSchema,
  removeMembershipSchema,
  sendInviteSchema,
  setPrimaryLeadSchema,
  setUserStatusSchema,
  teamMemberSchema,
  teamProjectRemoveSchema,
  teamProjectRoleSchema,
  teamProjectSchema,
  updateMembershipSchema,
  updateTeamSchema,
} from "./schemas";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const INVITE_TTL_MS = 72 * 60 * 60_000; // 72h
const ONE_HOUR_MS = 60 * 60_000;

/** Postgres unique-constraint violation (Prisma error code P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** Map an AuthorizationError to a user-facing message; anything else is generic. */
function friendlyAuthError(err: unknown): string {
  if (err instanceof AuthorizationError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return "You must be signed in to do that.";
      case "SUSPENDED":
        return "Your account has been suspended.";
      case "FORBIDDEN":
        return "You don't have permission to do that.";
    }
  }
  return "Something went wrong. Please try again.";
}

/** Build the invite/set-password link from the canonical app URL (never hardcoded). */
function buildInviteUrl(rawToken: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return `${base}/register?token=${rawToken}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Invites
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send an invite. Rate-limited to 20/hour per admin. `inviteUrl` is ALWAYS
 * returned (even when email delivery succeeds) so the UI can offer copy-link and
 * still work when SMTP is unconfigured.
 *
 * Enumeration note: this is an admin-only screen, so a clear "already a user"
 * message is acceptable and more useful than the deliberately-vague copy the
 * public auth flow uses — the operator needs to know why the invite was refused.
 *
 * If a still-pending (unaccepted, unrevoked, unexpired) invite already exists for
 * the email, we resend semantics: replace its token hash + expiry in place so the
 * old link stops working and only the newest link is valid.
 */
export async function sendInvite(
  input: unknown,
): Promise<ActionResult<{ inviteUrl: string; emailSent: boolean }>> {
  try {
    const admin = await requireAdmin();

    const parsed = sendInviteSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { email, intendedGlobalRole } = parsed.data;

    const limited = rateLimit(`admin:invite:${admin.id}`, {
      limit: 20,
      windowMs: ONE_HOUR_MS,
    });
    if (!limited.ok) {
      return {
        ok: false,
        error: "Invite limit reached (20/hour). Please try again later.",
      };
    }

    // Refuse to invite an email that already belongs to a real account. An
    // INVITED user (admin-created, awaiting set-password) is allowed through so
    // the invite acts as a resend of their set-password link.
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.status !== "INVITED") {
      return {
        ok: false,
        error: "That email already belongs to a user.",
      };
    }

    const now = new Date();
    const raw = generateInviteToken();
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    const pending = await prisma.invite.findFirst({
      where: {
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });

    await prisma.$transaction(async (tx) => {
      const row = pending
        ? await tx.invite.update({
            where: { id: pending.id },
            data: { tokenHash, expiresAt, intendedGlobalRole, invitedById: admin.id },
          })
        : await tx.invite.create({
            data: {
              email,
              intendedGlobalRole,
              tokenHash,
              expiresAt,
              invitedById: admin.id,
            },
          });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "invite.sent",
          targetType: "Invite",
          targetId: row.id,
          metadata: { email, intendedGlobalRole, resend: Boolean(pending) },
        },
      });
      return row;
    });

    const inviteUrl = buildInviteUrl(raw);
    const send = await sendInviteEmail({
      to: email,
      inviteUrl,
      invitedByName: admin.name,
    });

    revalidatePath("/admin/invites");
    revalidatePath("/admin/users");
    return { ok: true, data: { inviteUrl, emailSent: send.sent } };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/** Resend an invite: mint a fresh token + expiry (revive if previously revoked). */
export async function resendInvite(
  inviteId: string,
): Promise<ActionResult<{ inviteUrl: string; emailSent: boolean }>> {
  try {
    const admin = await requireAdmin();

    const parsed = inviteIdSchema.safeParse({ inviteId });
    if (!parsed.success) return { ok: false, error: "Invalid invite." };

    const invite = await prisma.invite.findUnique({
      where: { id: parsed.data.inviteId },
    });
    if (!invite) return { ok: false, error: "Invite not found." };
    if (invite.acceptedAt) {
      return { ok: false, error: "That invite was already accepted." };
    }

    const raw = generateInviteToken();
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    await prisma.$transaction(async (tx) => {
      await tx.invite.update({
        where: { id: invite.id },
        data: { tokenHash, expiresAt, revokedAt: null },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "invite.resent",
          targetType: "Invite",
          targetId: invite.id,
          metadata: { email: invite.email },
        },
      });
    });

    const inviteUrl = buildInviteUrl(raw);
    const send = await sendInviteEmail({
      to: invite.email,
      inviteUrl,
      invitedByName: admin.name,
    });

    revalidatePath("/admin/invites");
    return { ok: true, data: { inviteUrl, emailSent: send.sent } };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/** Revoke a pending invite (its link stops working immediately). */
export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = inviteIdSchema.safeParse({ inviteId });
    if (!parsed.success) return { ok: false, error: "Invalid invite." };

    const invite = await prisma.invite.findUnique({
      where: { id: parsed.data.inviteId },
    });
    if (!invite) return { ok: false, error: "Invite not found." };
    if (invite.acceptedAt) {
      return { ok: false, error: "That invite was already accepted." };
    }
    if (invite.revokedAt) {
      // Idempotent — already revoked.
      revalidatePath("/admin/invites");
      return { ok: true };
    }

    await prisma.$transaction(async (tx) => {
      await tx.invite.update({
        where: { id: invite.id },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "invite.revoked",
          targetType: "Invite",
          targetId: invite.id,
          metadata: { email: invite.email },
        },
      });
    });

    revalidatePath("/admin/invites");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a user directly. v1 policy: no temporary passwords — the account is
 * created with status INVITED and no password, bound to a fresh invite whose
 * set-password link is returned for the admin to share (and emailed if SMTP is
 * configured). The invitee completes the account through the normal register
 * flow (see the adapted `registerWithInvite`, which upgrades this INVITED row).
 */
export async function createUser(
  input: unknown,
): Promise<
  ActionResult<{ userId: string; inviteUrl: string; emailSent: boolean }>
> {
  try {
    const admin = await requireAdmin();

    const parsed = createUserSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { email, name, username, intendedGlobalRole, projectGrants } =
      parsed.data;

    // Admin-facing: clear, specific messages (see enumeration note on sendInvite).
    const [byEmail, byUsername] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { username } }),
    ]);
    if (byEmail) return { ok: false, error: "A user with that email already exists." };
    if (byUsername) return { ok: false, error: "That username is already taken." };

    // Dedupe grants by project (last role wins) and confirm every project
    // exists before we create anything.
    const grantsByProject = new Map(
      projectGrants.map((g) => [g.projectId, g.projectRole]),
    );
    if (grantsByProject.size > 0) {
      const found = await prisma.project.findMany({
        where: { id: { in: [...grantsByProject.keys()] } },
        select: { id: true },
      });
      if (found.length !== grantsByProject.size) {
        return { ok: false, error: "One or more selected projects don't exist." };
      }
    }

    const raw = generateInviteToken();
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name,
          username,
          globalRole: intendedGlobalRole,
          status: "INVITED",
          // hashedPassword intentionally omitted — set during registration.
        },
      });
      const invite = await tx.invite.create({
        data: {
          email,
          intendedGlobalRole,
          tokenHash,
          expiresAt,
          invitedById: admin.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "user.created",
          targetType: "User",
          targetId: created.id,
          metadata: {
            email,
            username,
            intendedGlobalRole,
            mode: "invite-link",
            inviteId: invite.id,
            grantedProjects: grantsByProject.size,
          },
        },
      });

      // Grant the chosen project access up front + audit each grant (same
      // "membership.granted" action as addProjectMember) so the new user has
      // something to see on first login.
      for (const [projectId, projectRole] of grantsByProject) {
        await tx.projectMembership.create({
          // manualRole marks this as an admin grant (not team/lead-derived) so it
          // survives access recompute and stays editable/removable — see access-sync.
          data: { projectId, userId: created.id, projectRole, manualRole: projectRole },
        });
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "membership.granted",
            targetType: "ProjectMembership",
            targetId: created.id,
            metadata: { projectId, userId: created.id, projectRole },
          },
        });
      }
      return created;
    });

    const inviteUrl = buildInviteUrl(raw);
    const send = await sendInviteEmail({
      to: email,
      inviteUrl,
      invitedByName: admin.name,
    });

    revalidatePath("/admin/users");
    return {
      ok: true,
      data: { userId: user.id, inviteUrl, emailSent: send.sent },
    };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, error: "That email or username is already in use." };
    }
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/**
 * Suspend or reactivate a user.
 *
 * JWT sessions note: there is no server-side session store to purge. Suspension
 * bites on the very next request because `lib/permissions.requireUser()`
 * re-fetches the user from the DB and rejects any status !== ACTIVE — even if the
 * user still holds a valid, unexpired JWT.
 *
 * Lockout guards: you cannot suspend yourself, and you cannot suspend the last
 * ACTIVE admin. INVITED users are managed through the invite flow, not this
 * toggle, so only ACTIVE↔SUSPENDED transitions are permitted here.
 */
export async function setUserStatus(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = setUserStatusSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input." };
    const { userId, status } = parsed.data;

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, error: "User not found." };
    if (target.status === status) {
      return { ok: true }; // idempotent no-op
    }

    if (status === "SUSPENDED") {
      if (target.id === admin.id) {
        return { ok: false, error: "You can't suspend your own account." };
      }
      if (target.status !== "ACTIVE") {
        return { ok: false, error: "Only active users can be suspended." };
      }
      if (target.globalRole === "ADMIN") {
        const activeAdmins = await prisma.user.count({
          where: { globalRole: "ADMIN", status: "ACTIVE" },
        });
        if (activeAdmins <= 1) {
          return { ok: false, error: "You can't suspend the last active admin." };
        }
      }
    } else {
      // Reactivate — only a suspended account can be brought back this way.
      if (target.status !== "SUSPENDED") {
        return { ok: false, error: "Only suspended users can be reactivated." };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status } });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: status === "SUSPENDED" ? "user.suspended" : "user.reactivated",
          targetType: "User",
          targetId: userId,
          metadata: { from: target.status, to: status },
        },
      });
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/**
 * Promote/demote a user's global role. Lockout guard: you cannot demote the last
 * ACTIVE admin (which also blocks demoting yourself when you are that last
 * admin). Old/new roles are recorded in the audit metadata.
 */
export async function changeGlobalRole(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = changeGlobalRoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input." };
    const { userId, role } = parsed.data;

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, error: "User not found." };
    if (target.globalRole === role) {
      return { ok: true }; // idempotent no-op
    }

    // Demotion guard (ADMIN → USER): never strip the final ACTIVE admin, or the
    // platform can be locked out of its own admin area.
    if (target.globalRole === "ADMIN" && role === "USER") {
      const activeAdmins = await prisma.user.count({
        where: { globalRole: "ADMIN", status: "ACTIVE" },
      });
      if (target.status === "ACTIVE" && activeAdmins <= 1) {
        return { ok: false, error: "You can't demote the last active admin." };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { globalRole: role } });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "user.role_changed",
          targetType: "User",
          targetId: userId,
          metadata: { from: target.globalRole, to: role },
        },
      });
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-project membership (global Admin OR the project's MANAGER — delegation)
// ─────────────────────────────────────────────────────────────────────────────

function revalidateMembership(projectId: string, userId: string): void {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/projects");
}

/** Grant (or re-grant) a user access to a project at a role. Upsert-safe. */
export async function addProjectMember(input: unknown): Promise<ActionResult> {
  try {
    const parsed = membershipSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input." };
    const { projectId, userId, projectRole } = parsed.data;

    // Delegation clause: global Admin bypasses, project MANAGER is allowed.
    const { user: actor } = await requireProjectRole(projectId, "MANAGER");

    const [project, target] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);
    if (!project) return { ok: false, error: "Project not found." };
    if (!target) return { ok: false, error: "User not found." };

    await prisma.$transaction(async (tx) => {
      await tx.projectMembership.upsert({
        where: { projectId_userId: { projectId, userId } },
        update: { manualRole: projectRole },
        create: { projectId, userId, projectRole, manualRole: projectRole },
      });
      await recomputeMembership(tx, projectId, userId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "membership.granted",
          targetType: "ProjectMembership",
          targetId: userId,
          metadata: { projectId, userId, projectRole },
        },
      });
    });

    revalidateMembership(projectId, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/** Change an existing member's role in a project. */
export async function updateProjectMember(input: unknown): Promise<ActionResult> {
  try {
    const parsed = updateMembershipSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input." };
    const { projectId, userId, projectRole } = parsed.data;

    const { user: actor } = await requireProjectRole(projectId, "MANAGER");

    const existing = await prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    // A row whose manualRole is null is purely team/lead-derived — not a manual
    // member, even though a ProjectMembership row exists for it.
    if (!existing || existing.manualRole === null) {
      return { ok: false, error: "That user isn't a member of this project." };
    }
    if (existing.manualRole === projectRole) {
      return { ok: true }; // idempotent no-op
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectMembership.update({
        where: { projectId_userId: { projectId, userId } },
        data: { manualRole: projectRole },
      });
      await recomputeMembership(tx, projectId, userId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "membership.role_changed",
          targetType: "ProjectMembership",
          targetId: userId,
          metadata: { projectId, userId, from: existing.manualRole, to: projectRole },
        },
      });
    });

    revalidateMembership(projectId, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/** Remove a user's access to a project. */
export async function removeProjectMember(input: unknown): Promise<ActionResult> {
  try {
    const parsed = removeMembershipSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid input." };
    const { projectId, userId } = parsed.data;

    const { user: actor } = await requireProjectRole(projectId, "MANAGER");

    const existing = await prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    // Idempotent — nothing to revoke when there's no row, or the row is
    // already purely team/lead-derived (no manual grant to clear).
    if (!existing || existing.manualRole === null) {
      revalidateMembership(projectId, userId);
      return { ok: true };
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectMembership.update({
        where: { projectId_userId: { projectId, userId } },
        data: { manualRole: null },
      });
      // Deletes the row iff nothing else justifies access (no team/lead
      // source); otherwise downgrades it to the remaining derived role.
      await recomputeMembership(tx, projectId, userId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "membership.revoked",
          targetType: "ProjectMembership",
          targetId: userId,
          metadata: { projectId, userId, projectRole: existing.projectRole },
        },
      });
    });

    revalidateMembership(projectId, userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Teams (Teams Org Foundation — Admin-only CRUD; member/project assignment and
// delegated manager actions land in later Phase B tasks)
// ─────────────────────────────────────────────────────────────────────────────

/** Create a team. */
export async function createTeam(
  input: unknown,
): Promise<ActionResult<{ teamId: string }>> {
  try {
    const admin = await requireAdmin();

    const parsed = createTeamSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { name, description } = parsed.data;

    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({ data: { name, description } });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "team.created",
          targetType: "Team",
          targetId: created.id,
          metadata: { name, description: description ?? null },
        },
      });
      return created;
    });

    revalidatePath("/admin/teams");
    return { ok: true, data: { teamId: team.id } };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/**
 * Update a team's name/description/isActive. Toggling `isActive` writes
 * `team.activated`/`team.deactivated` (otherwise `team.updated`) and triggers a
 * recompute, since an inactive team grants no derived project access (see
 * access-sync.recomputeMembership, which filters `team: { isActive: true }`).
 */
export async function updateTeam(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = updateTeamSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { teamId, name, description, isActive } = parsed.data;

    const existing = await prisma.team.findUnique({ where: { id: teamId } });
    if (!existing) return { ok: false, error: "Team not found." };

    const isActiveChanged =
      isActive !== undefined && isActive !== existing.isActive;

    const data: { name?: string; description?: string | null; isActive?: boolean } = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = isActive;

    await prisma.$transaction(async (tx) => {
      await tx.team.update({ where: { id: teamId }, data });
      if (isActiveChanged) {
        await recomputeForTeam(tx, teamId);
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: isActiveChanged
            ? isActive
              ? "team.activated"
              : "team.deactivated"
            : "team.updated",
          targetType: "Team",
          targetId: teamId,
          metadata: { name, description, isActive },
        },
      });
    });

    revalidatePath("/admin/teams");
    revalidatePath(`/admin/teams/${teamId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/**
 * Assign (or clear, with `managerId: null`) a team's manager. Recomputes access
 * for the team so the manager's own MANAGER-level access to the team's projects
 * takes effect immediately.
 */
export async function assignTeamManager(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = assignTeamManagerSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { teamId, managerId } = parsed.data;

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) return { ok: false, error: "Team not found." };
    const previousManagerId = team.managerId;

    if (managerId !== null) {
      const target = await prisma.user.findUnique({ where: { id: managerId } });
      if (!target) return { ok: false, error: "User not found." };
      if (target.status !== "ACTIVE") {
        return { ok: false, error: "Manager must be an active user." };
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.team.update({ where: { id: teamId }, data: { managerId } });
      await recomputeForTeam(tx, teamId);
      // recomputeForTeam only recomputes the CURRENT manager+members; a demoted
      // former manager is no longer in that set, so recompute them explicitly to
      // strip any MANAGER-derived access on the team's projects (unless still
      // justified elsewhere).
      if (previousManagerId && previousManagerId !== managerId) {
        const teamProjects = await tx.teamProject.findMany({
          where: { teamId },
          select: { projectId: true },
        });
        for (const { projectId } of teamProjects) {
          await recomputeMembership(tx, projectId, previousManagerId);
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "team.manager_assigned",
          targetType: "Team",
          targetId: teamId,
          metadata: { teamId, managerId },
        },
      });
    });

    revalidatePath("/admin/teams");
    revalidatePath(`/admin/teams/${teamId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Team membership (delegated: global Admin OR the team's own manager) +
// team↔project assignment (Admin-only). Teams Org Foundation, Phase B, Task B2.
//
// CRITICAL RECOMPUTE RULE: recomputeMembership/recomputeForTeam only re-evaluate
// the CURRENT derivation set. Any mutation that REMOVES someone from a
// derivation source (a member leaving a team, a team losing a project) must
// recompute THAT someone explicitly — they will not appear in the post-mutation
// set, so nothing else will ever re-evaluate their stale access.
// ─────────────────────────────────────────────────────────────────────────────

/** Add a user to a team. Delegated to Admin or the team's own manager. Idempotent. */
export async function addTeamMember(input: unknown): Promise<ActionResult> {
  try {
    const parsed = teamMemberSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { teamId, userId } = parsed.data;

    const actor = await requireTeamManage(teamId);

    const [team, target] = await Promise.all([
      prisma.team.findUnique({ where: { id: teamId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!team) return { ok: false, error: "Team not found." };
    if (!target) return { ok: false, error: "User not found." };

    const existing = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (existing) return { ok: true }; // idempotent no-op — already a member

    await prisma.$transaction(async (tx) => {
      await tx.teamMembership.create({ data: { teamId, userId } });

      // New member → recompute them across every project this team is
      // assigned to, so their team-derived access takes effect immediately.
      const teamProjects = await tx.teamProject.findMany({
        where: { teamId },
        select: { projectId: true },
      });
      for (const { projectId } of teamProjects) {
        await recomputeMembership(tx, projectId, userId);
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "team.member_added",
          targetType: "TeamMembership",
          targetId: userId,
          metadata: { teamId, userId },
        },
      });
    });

    revalidatePath("/admin/teams");
    revalidatePath(`/admin/teams/${teamId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/** Remove a user from a team. Delegated to Admin or the team's own manager. Idempotent. */
export async function removeTeamMember(input: unknown): Promise<ActionResult> {
  try {
    const parsed = teamMemberSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { teamId, userId } = parsed.data;

    const actor = await requireTeamManage(teamId);

    const existing = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!existing) return { ok: true }; // idempotent no-op — nothing to remove

    await prisma.$transaction(async (tx) => {
      await tx.teamMembership.delete({
        where: { teamId_userId: { teamId, userId } },
      });

      // CRITICAL: the removed user is gone from the team's current member set,
      // so recomputeForTeam would never see them again. Recompute them
      // explicitly across every project this team is assigned to, or any
      // team-derived access they held would survive as a stale grant.
      const teamProjects = await tx.teamProject.findMany({
        where: { teamId },
        select: { projectId: true },
      });
      for (const { projectId } of teamProjects) {
        await recomputeMembership(tx, projectId, userId);
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "team.member_removed",
          targetType: "TeamMembership",
          targetId: userId,
          metadata: { teamId, userId },
        },
      });
    });

    revalidatePath("/admin/teams");
    revalidatePath(`/admin/teams/${teamId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/** Fetch a team's current member ids + manager id (for recompute fan-out). */
async function teamPeopleIds(
  tx: Prisma.TransactionClient,
  teamId: string,
  managerId: string | null | undefined,
): Promise<Set<string>> {
  const members = await tx.teamMembership.findMany({
    where: { teamId },
    select: { userId: true },
  });
  const userIds = new Set(members.map((m) => m.userId));
  if (managerId) userIds.add(managerId);
  return userIds;
}

/**
 * Assign (or re-assign, with a new role) a team to a project. Admin-only.
 * Upsert-safe — calling it again for the same (team, project) simply sets the
 * role, so it never throws on the unique constraint.
 */
export async function assignTeamProject(
  input: unknown,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = teamProjectSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { teamId, projectId, role } = parsed.data;

    const [team, project] = await Promise.all([
      prisma.team.findUnique({ where: { id: teamId } }),
      prisma.project.findUnique({ where: { id: projectId } }),
    ]);
    if (!team) return { ok: false, error: "Team not found." };
    if (!project) return { ok: false, error: "Project not found." };

    await prisma.$transaction(async (tx) => {
      await tx.teamProject.upsert({
        where: { teamId_projectId: { teamId, projectId } },
        update: { role },
        create: { teamId, projectId, role },
      });

      // The team now grants (or updates) access to this ONE project — recompute
      // every current member + the manager for just that project.
      const userIds = await teamPeopleIds(tx, teamId, team.managerId);
      for (const userId of userIds) {
        await recomputeMembership(tx, projectId, userId);
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "team.project_assigned",
          targetType: "TeamProject",
          targetId: teamId,
          metadata: { teamId, projectId, role },
        },
      });
    });

    revalidatePath("/admin/teams");
    revalidatePath(`/admin/teams/${teamId}`);
    revalidatePath(`/admin/projects/${projectId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/** Change the role a team's assignment grants on a project. Admin-only. */
export async function updateTeamProjectRole(
  input: unknown,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = teamProjectRoleSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { teamId, projectId, role } = parsed.data;

    const existing = await prisma.teamProject.findUnique({
      where: { teamId_projectId: { teamId, projectId } },
    });
    if (!existing) {
      return { ok: false, error: "This team isn't assigned to that project." };
    }
    if (existing.role === role) {
      return { ok: true }; // idempotent no-op
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamProject.update({
        where: { teamId_projectId: { teamId, projectId } },
        data: { role },
      });

      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: { managerId: true },
      });
      const userIds = await teamPeopleIds(tx, teamId, team?.managerId);
      for (const userId of userIds) {
        await recomputeMembership(tx, projectId, userId);
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "team.project_role_changed",
          targetType: "TeamProject",
          targetId: teamId,
          metadata: { teamId, projectId, from: existing.role, to: role },
        },
      });
    });

    revalidatePath("/admin/teams");
    revalidatePath(`/admin/teams/${teamId}`);
    revalidatePath(`/admin/projects/${projectId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/** Unassign a team from a project. Admin-only. Idempotent. */
export async function unassignTeamProject(
  input: unknown,
): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = teamProjectRemoveSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { teamId, projectId } = parsed.data;

    const existing = await prisma.teamProject.findUnique({
      where: { teamId_projectId: { teamId, projectId } },
    });
    if (!existing) return { ok: true }; // idempotent no-op — nothing to unassign

    await prisma.$transaction(async (tx) => {
      // CRITICAL: capture the team's members + manager BEFORE the delete.
      // recomputeMembership only re-evaluates the CURRENT derivation set, and
      // once this TeamProject row is gone, tx.teamProject.findMany would never
      // surface these people for this project again — capture first, or their
      // stale team-derived access on this project can never be recomputed away.
      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: { managerId: true },
      });
      const userIds = await teamPeopleIds(tx, teamId, team?.managerId);

      await tx.teamProject.delete({
        where: { teamId_projectId: { teamId, projectId } },
      });

      for (const userId of userIds) {
        await recomputeMembership(tx, projectId, userId);
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "team.project_unassigned",
          targetType: "TeamProject",
          targetId: teamId,
          metadata: { teamId, projectId, role: existing.role },
        },
      });
    });

    revalidatePath("/admin/teams");
    revalidatePath(`/admin/teams/${teamId}`);
    revalidatePath(`/admin/projects/${projectId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Project leads (Teams Org Foundation, Task B3) — multiple leads per project.
// `Project.leadId` is the required PRIMARY lead; `ProjectLead` rows are
// additional co-leads. Lead access = MANAGER on the project — access-sync's
// recomputeMembership already treats `leadId === user OR a ProjectLead row` as
// a MANAGER source, so every mutation here just writes the lead relationship
// and recomputes the affected user(s). All Admin-only.
// ─────────────────────────────────────────────────────────────────────────────

function revalidateLeads(projectId: string): void {
  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin/projects");
}

/** Add a co-lead to a project. Upsert-safe (idempotent on the unique key). */
export async function addProjectLead(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = projectLeadSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { projectId, userId } = parsed.data;

    const [project, target] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!project) return { ok: false, error: "Project not found." };
    if (!target) return { ok: false, error: "User not found." };
    if (target.status !== "ACTIVE") {
      return { ok: false, error: "Lead must be an active user." };
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectLead.upsert({
        where: { projectId_userId: { projectId, userId } },
        update: {},
        create: { projectId, userId },
      });
      await recomputeMembership(tx, projectId, userId);
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "lead.added",
          targetType: "ProjectLead",
          targetId: userId,
          metadata: { projectId, userId },
        },
      });
    });

    revalidateLeads(projectId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/**
 * Remove a co-lead from a project. The primary lead (`Project.leadId`) can
 * never be left empty, so removing the current primary is refused — the admin
 * must call `setPrimaryLead` to reassign it first. Idempotent when no
 * `ProjectLead` row exists for a non-primary user.
 */
export async function removeProjectLead(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = projectLeadSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { projectId, userId } = parsed.data;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { leadId: true },
    });
    if (!project) return { ok: false, error: "Project not found." };

    if (userId === project.leadId) {
      return {
        ok: false,
        error: "Reassign the primary lead before removing them.",
      };
    }

    const existing = await prisma.projectLead.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!existing) return { ok: true }; // idempotent no-op — nothing to remove

    await prisma.$transaction(async (tx) => {
      await tx.projectLead.delete({
        where: { projectId_userId: { projectId, userId } },
      });
      await recomputeMembership(tx, projectId, userId);
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "lead.removed",
          targetType: "ProjectLead",
          targetId: userId,
          metadata: { projectId, userId },
        },
      });
    });

    revalidateLeads(projectId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/**
 * Reassign the project's PRIMARY lead. Ensures the new primary also has a
 * `ProjectLead` row (so they remain a co-lead if later demoted from primary),
 * then flips `Project.leadId`. Both the old and new primary are recomputed —
 * the old primary may lose their MANAGER-derived access entirely if they
 * aren't also a co-lead via a `ProjectLead` row.
 */
export async function setPrimaryLead(input: unknown): Promise<ActionResult> {
  try {
    const admin = await requireAdmin();

    const parsed = setPrimaryLeadSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      };
    }
    const { projectId, userId } = parsed.data;

    const [project, target] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { leadId: true } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!project) return { ok: false, error: "Project not found." };
    if (!target) return { ok: false, error: "User not found." };
    if (target.status !== "ACTIVE") {
      return { ok: false, error: "Lead must be an active user." };
    }

    const oldPrimaryId = project.leadId;
    if (oldPrimaryId === userId) {
      return { ok: true }; // idempotent no-op — already the primary
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectLead.upsert({
        where: { projectId_userId: { projectId, userId } },
        update: {},
        create: { projectId, userId },
      });
      await tx.project.update({ where: { id: projectId }, data: { leadId: userId } });

      // The former primary is no longer covered by `leadId === user`; recompute
      // them so any now-unjustified MANAGER-derived access is stripped (unless
      // they still hold a ProjectLead row as a co-lead).
      await recomputeMembership(tx, projectId, oldPrimaryId);
      await recomputeMembership(tx, projectId, userId);

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "lead.primary_changed",
          targetType: "Project",
          targetId: projectId,
          metadata: { projectId, from: oldPrimaryId, to: userId },
        },
      });
    });

    revalidateLeads(projectId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}
