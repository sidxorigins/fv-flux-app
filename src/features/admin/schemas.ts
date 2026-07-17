// Admin Zod schemas — the single source of truth reused by client forms AND by
// every admin Server Action / query (see CLAUDE.md "Validate at the boundary").
// Field-level validators (email / username) are reused from the auth feature so
// the admin area can never drift from what registration enforces.

import { z } from "zod";

import { emailSchema, usernameSchema } from "@/features/auth/schemas";

// ── Enum schemas (mirror the Prisma enums) ──────────────────────────────────
export const globalRoleSchema = z.enum(["ADMIN", "USER"]);
export const projectRoleSchema = z.enum(["MANAGER", "MEMBER", "VIEWER"]);

/**
 * Statuses an Admin may set via the suspend/reactivate control. `INVITED` is a
 * system-managed state (owned by the invite/registration flow), so it is
 * deliberately NOT settable here — you can only move a user between ACTIVE and
 * SUSPENDED. See `setUserStatus` in actions.ts for the transition guards.
 */
export const settableUserStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);

/** Display name — same shape the register form uses. */
const nameSchema = z.string().trim().min(1, "Name is required").max(80);

// ── Invites ─────────────────────────────────────────────────────────────────
export const sendInviteSchema = z.object({
  email: emailSchema,
  intendedGlobalRole: globalRoleSchema.default("USER"),
});

/** revoke / resend take a single invite id. */
export const inviteIdSchema = z.object({
  inviteId: z.string().min(1, "Missing invite id"),
});

// ── Users ───────────────────────────────────────────────────────────────────
/**
 * Admin-created account. v1 policy: admin-created accounts ALWAYS receive a
 * set-password / invite link — there are NO temporary passwords issued from the
 * dashboard (avoids plaintext-password handling and out-of-band delivery). The
 * `mode` field is fixed to "invite-link" so the shape can grow later (e.g. a
 * "temp-password" mode) without a breaking change, but v1 only accepts the one.
 */
export const createUserSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  username: usernameSchema,
  intendedGlobalRole: globalRoleSchema.default("USER"),
  mode: z.literal("invite-link").default("invite-link"),
  // Optional per-project access granted at creation, so the new user lands on
  // a visible project at first login instead of the empty "an admin will add
  // you" state. Deduped/validated server-side.
  projectGrants: z
    .array(
      z.object({
        projectId: z.string().min(1),
        projectRole: projectRoleSchema,
      }),
    )
    .max(50)
    .optional()
    .default([]),
});

export const changeGlobalRoleSchema = z.object({
  userId: z.string().min(1, "Missing user id"),
  role: globalRoleSchema,
});

export const setUserStatusSchema = z.object({
  userId: z.string().min(1, "Missing user id"),
  status: settableUserStatusSchema,
});

// ── Per-project membership (the "give role-based access" screen) ─────────────
export const membershipSchema = z.object({
  projectId: z.string().min(1, "Missing project id"),
  userId: z.string().min(1, "Missing user id"),
  projectRole: projectRoleSchema,
});

export const updateMembershipSchema = z.object({
  projectId: z.string().min(1, "Missing project id"),
  userId: z.string().min(1, "Missing user id"),
  projectRole: projectRoleSchema,
});

export const removeMembershipSchema = z.object({
  projectId: z.string().min(1, "Missing project id"),
  userId: z.string().min(1, "Missing user id"),
});

// ── Audit log query ─────────────────────────────────────────────────────────
export const auditQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  action: z.string().trim().max(100).optional(),
});

// ── User search query ───────────────────────────────────────────────────────
export const userSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["INVITED", "ACTIVE", "SUSPENDED"]).optional(),
  cursor: z.string().min(1).optional(),
});

export type SendInviteInput = z.infer<typeof sendInviteSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ChangeGlobalRoleInput = z.infer<typeof changeGlobalRoleSchema>;
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;
export type MembershipInput = z.infer<typeof membershipSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;
export type RemoveMembershipInput = z.infer<typeof removeMembershipSchema>;
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
export type UserSearchInput = z.infer<typeof userSearchSchema>;
