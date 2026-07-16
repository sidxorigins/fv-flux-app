// Central authorisation — the ONLY place role/access checks live.
//
// Two-tier model (CLAUDE.md "Security Requirements"):
//   1. Global role: ADMIN vs USER — gates the admin area and platform actions.
//   2. Per-project access: ProjectMembership.projectRole — gates everything
//      inside a project. Ordered VIEWER (read) < MEMBER (edit tasks) < MANAGER
//      (manage project & members).
//
// ADMIN-BYPASS POLICY (locked, applied consistently): a global ADMIN passes every
// per-project check WITHOUT needing a ProjectMembership row. CLAUDE.md permits a
// global Admin to bypass project checks by policy; this module is the single place
// that policy is implemented, so it stays consistent everywhere.
//
// DB IS THE SOURCE OF TRUTH, NOT THE JWT: every helper re-fetches the user and
// requires status === ACTIVE. Suspending a user therefore takes effect on the very
// next request, even if the user still holds a valid (un-expired) JWT.

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { ProjectRole } from "@/generated/prisma/enums";
import type { User } from "@/generated/prisma/client";

/** VIEWER < MEMBER < MANAGER — compare with `>=` to test "at least this role". */
export const PROJECT_ROLE_ORDER = {
  VIEWER: 0,
  MEMBER: 1,
  MANAGER: 2,
} as const satisfies Record<ProjectRole, number>;

export type AuthErrorCode = "UNAUTHENTICATED" | "SUSPENDED" | "FORBIDDEN";

/**
 * Typed authorisation failure. Callers (server actions / route handlers) map the
 * `code` to an HTTP status or a discriminated result:
 *   UNAUTHENTICATED → 401, SUSPENDED → 403 (session invalidated), FORBIDDEN → 403.
 *
 * Named `AuthorizationError` (not `AuthError`) to avoid colliding with Auth.js's
 * own exported `AuthError`, which represents *authentication* failures.
 */
export class AuthorizationError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AuthorizationError";
    this.code = code;
  }
}

/**
 * Resolve the authenticated + ACTIVE user from the session, re-fetched from the DB.
 * Throws AuthorizationError("UNAUTHENTICATED") when there is no valid session/user,
 * or ("SUSPENDED") when the account is not ACTIVE.
 */
export async function requireUser(): Promise<User> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AuthorizationError("UNAUTHENTICATED");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  // User could have been deleted since the JWT was issued.
  if (!user) throw new AuthorizationError("UNAUTHENTICATED");
  if (user.status !== "ACTIVE") throw new AuthorizationError("SUSPENDED");

  return user;
}

/** Require an ACTIVE global Admin. Throws FORBIDDEN for non-admins. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.globalRole !== "ADMIN") throw new AuthorizationError("FORBIDDEN");
  return user;
}

/** The user's role in a project, or null if they have no membership there. */
export async function getProjectRole(
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  const membership = await prisma.projectMembership.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { projectRole: true },
  });
  return membership?.projectRole ?? null;
}

/**
 * Require that the current user can act on `projectId` at `minRole` or higher.
 * Global Admins bypass the membership check (see ADMIN-BYPASS POLICY above) and
 * are reported with an effective role of MANAGER.
 *
 * Returns the ACTIVE user and their effective role. Throws FORBIDDEN otherwise.
 */
export async function requireProjectRole(
  projectId: string,
  minRole: ProjectRole,
): Promise<{ user: User; role: ProjectRole }> {
  const user = await requireUser();

  if (user.globalRole === "ADMIN") {
    return { user, role: "MANAGER" };
  }

  const role = await getProjectRole(user.id, projectId);
  if (!role || PROJECT_ROLE_ORDER[role] < PROJECT_ROLE_ORDER[minRole]) {
    throw new AuthorizationError("FORBIDDEN");
  }
  return { user, role };
}

// Convenience wrappers — each throws AuthorizationError on failure and returns
// { user, role } on success.

/** MANAGER+ : manage the project and its memberships. */
export function canManageProject(projectId: string) {
  return requireProjectRole(projectId, "MANAGER");
}

/** MEMBER+ : create / edit tasks in the project. */
export function canEditTasks(projectId: string) {
  return requireProjectRole(projectId, "MEMBER");
}

/** VIEWER+ : read the project. */
export function canViewProject(projectId: string) {
  return requireProjectRole(projectId, "VIEWER");
}
