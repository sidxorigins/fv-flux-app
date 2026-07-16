"use server";

// Project Server Actions. Every action: Zod-validate the input → run a permission
// helper from lib/permissions → do all writes in ONE transaction → revalidate the
// affected views. Everything returns the discriminated `{ ok }` union so the UI
// never has to catch thrown errors.
//
// AUTHORISATION MODEL (v1, documented):
//   - Creating and deleting a project are ADMIN-level platform actions (a project is
//     an org-wide container; spinning one up / tearing one down is deliberate and
//     rare — CLAUDE.md marks project deletion Admin-only, and we treat creation the
//     same way for symmetry).
//   - Editing an existing project (name / description / lead) is a project MANAGER
//     action (or a global Admin via the bypass policy in lib/permissions).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { deleteObjects } from "@/lib/r2";
import {
  AuthorizationError,
  requireAdmin,
  requireProjectRole,
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
// createProject — ADMIN only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a project. The lead defaults to the creating admin; both the creator and
 * the lead (if different) are added as MANAGER members so they can immediately act
 * on the project. Writes an AuditLog entry. A duplicate `key` returns a friendly
 * error rather than throwing.
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
    const admin = await requireAdmin();
    const resolvedLeadId = leadId ?? admin.id;

    const project = await prisma.$transaction(async (tx) => {
      // Validate an explicitly-supplied lead exists and is active. (When the lead
      // is the creator we already know they're active from requireAdmin.)
      if (resolvedLeadId !== admin.id) {
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

      // Unique userIds → one MANAGER membership each (creator + lead).
      const managerIds = [...new Set([admin.id, resolvedLeadId])];
      await tx.projectMembership.createMany({
        data: managerIds.map((userId) => ({
          projectId: created.id,
          userId,
          projectRole: "MANAGER" as const,
        })),
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
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
 * Update a project's name / description / lead. Changing the lead is audited. To
 * avoid handing the project to a lead who can't see it, a new lead without a
 * membership is granted MANAGER access; an existing membership is left untouched
 * (we never silently downgrade a member's role here).
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
        // Ensure the new lead can access the project; don't disturb an existing role.
        const existing = await tx.projectMembership.findUnique({
          where: { projectId_userId: { projectId, userId: data.leadId! } },
          select: { id: true },
        });
        if (!existing) {
          await tx.projectMembership.create({
            data: { projectId, userId: data.leadId!, projectRole: "MANAGER" },
          });
        }
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
