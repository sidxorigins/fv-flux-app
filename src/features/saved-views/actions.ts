"use server";

// Saved view Server Actions. Zod-validate → permission check → write → revalidate.
// Returns the discriminated `{ ok }` union used across the codebase (see
// features/tasks/actions.ts / features/tasks/labels.ts, mirrored here).
//
// Permission levels:
//   - createSavedView: project VIEWER+. Saving a view only persists the caller's
//     OWN filter/sort preference for a project they can already see — it never
//     mutates task data, so it doesn't need MEMBER's edit rights. A Viewer who
//     filters the backlog should be able to save that filter too.
//   - deleteSavedView: owner-only, regardless of project role. A saved view is a
//     personal preference; ownership (userId === session user) is the check, not
//     project role — even a MANAGER can't delete another user's saved view.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthorizationError, requireProjectRole, requireUser } from "@/lib/permissions";
import { createSavedViewSchema, deleteSavedViewSchema } from "./schemas";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
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

/** Saved views only surface in the project's backlog filter bar. */
function revalidateProjectViews(projectId: string): void {
  revalidatePath(`/projects/${projectId}`, "layout");
}

/**
 * Save (or re-save) the current backlog filters+sort under a name, scoped to the
 * signed-in user and project. Upserts on the (userId, projectId, name) unique key,
 * so saving under an existing name silently updates that view's query instead of
 * erroring — the whole point of naming a view is to be able to refresh it later.
 */
export async function createSavedView(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSavedViewSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { projectId, name, query } = parsed.data;

  try {
    const { user } = await requireProjectRole(projectId, "VIEWER");

    const view = await prisma.savedView.upsert({
      where: { userId_projectId_name: { userId: user.id, projectId, name } },
      create: { userId: user.id, projectId, name, query },
      update: { query },
      select: { id: true },
    });

    revalidateProjectViews(projectId);
    return { ok: true, data: { id: view.id } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    return fail("Something went wrong. Please try again.");
  }
}

/** Delete a saved view. Only its owner may delete it. */
export async function deleteSavedView(id: string): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteSavedViewSchema.safeParse({ id });
  if (!parsed.success) return fail("Invalid input");

  try {
    const user = await requireUser();

    const view = await prisma.savedView.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, userId: true, projectId: true },
    });
    if (!view) return fail("Saved view not found.");
    if (view.userId !== user.id) {
      return fail("You can only delete your own saved views.");
    }

    await prisma.savedView.delete({ where: { id: view.id } });

    revalidateProjectViews(view.projectId);
    return { ok: true, data: { id: view.id } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    return fail("Something went wrong. Please try again.");
  }
}
