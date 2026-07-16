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

import { prisma } from "@/lib/db";
import {
  AuthorizationError,
  requireAdmin,
  requireProjectRole,
} from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { sendInviteEmail } from "@/lib/mail";
import { generateInviteToken, hashToken } from "@/lib/tokens";

import {
  changeGlobalRoleSchema,
  createUserSchema,
  inviteIdSchema,
  membershipSchema,
  removeMembershipSchema,
  sendInviteSchema,
  setUserStatusSchema,
  updateMembershipSchema,
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
    const { email, name, username, intendedGlobalRole } = parsed.data;

    // Admin-facing: clear, specific messages (see enumeration note on sendInvite).
    const [byEmail, byUsername] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { username } }),
    ]);
    if (byEmail) return { ok: false, error: "A user with that email already exists." };
    if (byUsername) return { ok: false, error: "That username is already taken." };

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
          },
        },
      });
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
        update: { projectRole },
        create: { projectId, userId, projectRole },
      });
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
    if (!existing) {
      return { ok: false, error: "That user isn't a member of this project." };
    }
    if (existing.projectRole === projectRole) {
      return { ok: true }; // idempotent no-op
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectMembership.update({
        where: { projectId_userId: { projectId, userId } },
        data: { projectRole },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "membership.role_changed",
          targetType: "ProjectMembership",
          targetId: userId,
          metadata: { projectId, userId, from: existing.projectRole, to: projectRole },
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
    if (!existing) {
      // Idempotent — nothing to remove.
      revalidateMembership(projectId, userId);
      return { ok: true };
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectMembership.delete({
        where: { projectId_userId: { projectId, userId } },
      });
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
