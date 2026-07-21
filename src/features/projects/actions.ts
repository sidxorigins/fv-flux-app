"use server";

// Project Server Actions. Every action: Zod-validate the input → run a permission
// helper from lib/permissions → do all writes in ONE transaction → revalidate the
// affected views. Everything returns the discriminated `{ ok }` union so the UI
// never has to catch thrown errors.
//
// AUTHORISATION MODEL (v1, documented):
//   - Creating a project is open to any active user — the creator becomes the
//     project's lead and MANAGER (self-service; only a global Admin may hand the
//     lead to someone else).
//   - Deleting a project is an ADMIN-level platform action (tearing down an
//     org-wide container is deliberate and rare — CLAUDE.md marks it Admin-only).
//   - Editing an existing project (name / description / lead) is a project MANAGER
//     action (or a global Admin via the bypass policy in lib/permissions).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { deleteObjects } from "@/lib/r2";
import { recomputeMembership } from "@/lib/access-sync";
import {
  AuthorizationError,
  requireAdmin,
  requireProjectRole,
  requireUser,
} from "@/lib/permissions";
import { createProjectSchema, updateProjectSchema } from "./schemas";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Thrown inside a transaction to abort with a specific user-facing message. */
class ActionError extends Error {}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Postgres unique-constraint violation (Prisma error code P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** Prisma "record not found" for a required where (P2025). */
function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2025"
  );
}

/** Map an AuthorizationError to a friendly result, or null if it isn't one. */
function mapAuthError(err: unknown): { ok: false; error: string } | null {
  if (err instanceof AuthorizationError) {
    switch (err.code) {
      case "UNAUTHENTICATED":
        return fail("You must be signed in.");
      case "SUSPENDED":
        return fail("Your account is suspended.");
      case "FORBIDDEN":
        return fail("You don't have permission to do that.");
    }
  }
  return null;
}

function revalidateProjectViews(projectId: string): void {
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  // "layout" revalidates every nested route under the project (board, backlog, tasks).
  revalidatePath(`/projects/${projectId}`, "layout");
}

// ─────────────────────────────────────────────────────────────────────────────
// createProject — any active user (creator becomes lead + MANAGER)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a project. The lead defaults to the creator; only a global Admin may
 * assign a different lead. Both the creator and the lead (if different) are added
 * as MANAGER members so they can immediately act on the project. Writes an
 * AuditLog entry. A duplicate `key` returns a friendly error rather than throwing.
 */
export async function createProject(
  input: unknown,
): Promise<ActionResult<{ id: string; key: string }>> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { key, name, description, leadId } = parsed.data;

  try {
    // Any active user may create a project — the creator becomes its lead and
    // MANAGER. Only a global Admin may hand the lead to someone else; a regular
    // creator always leads their own project.
    const creator = await requireUser();
    const isAdmin = creator.globalRole === "ADMIN";
    const resolvedLeadId = isAdmin ? (leadId ?? creator.id) : creator.id;

    const project = await prisma.$transaction(async (tx) => {
      // Validate an explicitly-supplied lead exists and is active. (When the lead
      // is the creator we already know they're active from requireUser.)
      if (resolvedLeadId !== creator.id) {
        const lead = await tx.user.findUnique({
          where: { id: resolvedLeadId },
          select: { status: true },
        });
        if (!lead || lead.status !== "ACTIVE") {
          throw new ActionError("The selected project lead is not a valid user.");
        }
      }

      const created = await tx.project.create({
        data: { key, name, description: description ?? null, leadId: resolvedLeadId },
        select: { id: true, key: true },
      });

      // Unique userIds → one MANAGER membership each (creator + lead). manualRole
      // marks these as structural admin/creator grants (not team/lead-derived) so
      // recomputeMembership preserves them instead of deleting them later.
      const managerIds = [...new Set([creator.id, resolvedLeadId])];
      await tx.projectMembership.createMany({
        data: managerIds.map((userId) => ({
          projectId: created.id,
          userId,
          projectRole: "MANAGER" as const,
          manualRole: "MANAGER" as const,
        })),
      });

      // Track the primary lead in ProjectLead too, like backfilled projects, so
      // recompute's `leadId === user OR a ProjectLead row` MANAGER source is
      // consistent for every project regardless of when it was created.
      await tx.projectLead.create({
        data: { projectId: created.id, userId: resolvedLeadId },
      });

      await tx.auditLog.create({
        data: {
          actorId: creator.id,
          action: "project.created",
          targetType: "Project",
          targetId: created.id,
          metadata: { key: created.key, name, leadId: resolvedLeadId },
        },
      });

      return created;
    });

    revalidateProjectViews(project.id);
    return { ok: true, data: { id: project.id, key: project.key } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (err instanceof ActionError) return fail(err.message);
    if (isUniqueViolation(err)) {
      return fail("That project key is already in use.");
    }
    return fail("Something went wrong. Please try again.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// updateProject — project MANAGER (or global Admin)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a project's name / description / lead. Changing the lead is audited and
 * routed through the access-sync engine (same approach as `setPrimaryLead`): the
 * new lead gets a `ProjectLead` row and is recomputed (gaining MANAGER via
 * `leadId === user`), and the former primary is recomputed too so stale
 * MANAGER-derived access is stripped unless they remain a co-lead.
 */
export async function updateProject(
  projectId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;

  try {
    const { user } = await requireProjectRole(projectId, "MANAGER");

    const current = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, leadId: true },
    });
    if (!current) return fail("Project not found.");

    const leadChanged =
      data.leadId !== undefined && data.leadId !== current.leadId;

    await prisma.$transaction(async (tx) => {
      if (leadChanged) {
        const newLead = await tx.user.findUnique({
          where: { id: data.leadId! },
          select: { status: true },
        });
        if (!newLead || newLead.status !== "ACTIVE") {
          throw new ActionError("The selected project lead is not a valid user.");
        }
        // Ensure the new lead has a ProjectLead row (so they remain a co-lead if
        // later demoted from primary) — same approach as setPrimaryLead.
        await tx.projectLead.upsert({
          where: { projectId_userId: { projectId, userId: data.leadId! } },
          update: {},
          create: { projectId, userId: data.leadId! },
        });
      }

      await tx.project.update({
        where: { id: projectId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.leadId !== undefined ? { leadId: data.leadId } : {}),
        },
      });

      if (leadChanged) {
        // Route the effective-access change through the recompute engine instead
        // of ad-hoc membership writes: the new lead gains MANAGER via
        // `leadId === user`, and the former primary is recomputed so any now-
        // unjustified MANAGER-derived access is stripped (unless they still hold
        // a ProjectLead row as a co-lead — matches setPrimaryLead exactly; the
        // former primary is NOT auto-removed as a co-lead).
        await recomputeMembership(tx, projectId, data.leadId!);
        await recomputeMembership(tx, projectId, current.leadId);

        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: "project.lead_changed",
            targetType: "Project",
            targetId: projectId,
            metadata: { from: current.leadId, to: data.leadId },
          },
        });
      }
    });

    revalidateProjectViews(projectId);
    return { ok: true, data: { id: projectId } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (err instanceof ActionError) return fail(err.message);
    return fail("Something went wrong. Please try again.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteProject — ADMIN only (deliberate, destructive)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete a project and everything under it. Cascades (schema-level) remove
 * memberships, labels, tasks, and each task's comments/attachments/activity rows.
 * The R2 *objects* behind those attachments are NOT cascaded, so we collect every
 * attachment key FIRST, delete the DB records, then delete the R2 objects —
 * tolerating partial R2 failure by recording the failed keys in an AuditLog entry
 * for a later orphan-cleanup sweep.
 */
export async function deleteProject(
  projectId: string,
): Promise<ActionResult<{ deletedR2: number; failedR2: number }>> {
  try {
    const admin = await requireAdmin();

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, key: true, name: true },
    });
    if (!project) return fail("Project not found.");

    // Collect every R2 key BEFORE the cascade removes the attachment rows.
    const attachments = await prisma.attachment.findMany({
      where: { task: { projectId } },
      select: { key: true },
    });
    const keys = attachments.map((a) => a.key);

    // DB delete first (single atomic statement, cascades everything below it).
    await prisma.project.delete({ where: { id: projectId } });

    // Then the object store — never throws for partial failure.
    const { deleted, failed } = await deleteObjects(keys);

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "project.deleted",
        targetType: "Project",
        targetId: projectId,
        metadata: {
          key: project.key,
          name: project.name,
          deletedR2: deleted.length,
          // Empty when everything cleaned up; populated keys drive orphan cleanup.
          failedR2Keys: failed,
        },
      },
    });

    revalidateProjectViews(projectId);
    return { ok: true, data: { deletedR2: deleted.length, failedR2: failed.length } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (isNotFound(err)) return fail("Project not found.");
    return fail("Something went wrong. Please try again.");
  }
}
