"use server";

// Label Server Actions (kept separate from tasks/actions to keep that file focused).
// Read access to labels lives in tasks/queries (getProjectLabels). Roles:
//   - create / update: project MEMBER+ (creating tasks needs to add/adjust labels)
//   - delete:          project MANAGER+ (destructive — removes the label from every task)
// Labels aren't tasks, so no ActivityLog; they aren't security events, so no AuditLog.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthorizationError, requireProjectRole } from "@/lib/permissions";
import {
  createLabelSchema,
  deleteLabelSchema,
  updateLabelSchema,
} from "./schemas";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

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
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** Create a label in a project (MEMBER+). Duplicate names (per project) fail friendly. */
export async function createLabel(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createLabelSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { projectId, name, color } = parsed.data;

  try {
    await requireProjectRole(projectId, "MEMBER");
    const label = await prisma.label.create({
      data: { projectId, name, color },
      select: { id: true },
    });
    revalidateProjectViews(projectId);
    return { ok: true, data: { id: label.id } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (isUniqueViolation(err)) {
      return fail("A label with that name already exists in this project.");
    }
    return fail("Something went wrong. Please try again.");
  }
}

/** Rename / recolour a label (MEMBER+). */
export async function updateLabel(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateLabelSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { labelId, name, color } = parsed.data;

  try {
    const label = await prisma.label.findUnique({
      where: { id: labelId },
      select: { projectId: true },
    });
    if (!label) return fail("Label not found.");

    await requireProjectRole(label.projectId, "MEMBER");

    await prisma.label.update({
      where: { id: labelId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    });
    revalidateProjectViews(label.projectId);
    return { ok: true, data: { id: labelId } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    if (isUniqueViolation(err)) {
      return fail("A label with that name already exists in this project.");
    }
    return fail("Something went wrong. Please try again.");
  }
}

/** Delete a label (MANAGER+). Its task associations are removed automatically. */
export async function deleteLabel(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteLabelSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");
  const { labelId } = parsed.data;

  try {
    const label = await prisma.label.findUnique({
      where: { id: labelId },
      select: { projectId: true },
    });
    if (!label) return fail("Label not found.");

    await requireProjectRole(label.projectId, "MANAGER");

    await prisma.label.delete({ where: { id: labelId } });
    revalidateProjectViews(label.projectId);
    return { ok: true, data: { id: labelId } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    return fail("Something went wrong. Please try again.");
  }
}
