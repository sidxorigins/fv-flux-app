"use server";

// Saved filter Server Actions. Zod-validate → auth → write → revalidate.
// Returns the discriminated `{ ok }` union used across the codebase (see
// features/tasks/actions.ts / features/saved-views/actions.ts, mirrored here).
//
// SavedFilter is the GLOBAL (no projectId) analog of SavedView, for the
// /explore cross-project filter bar:
//   - createSavedFilter: any signed-in ACTIVE user. Saving a filter only
//     persists the caller's OWN filter combo — it never mutates task data or
//     widens what they can see, so there's no project-role check at all
//     (unlike SavedView, which is scoped to a project the caller can view).
//   - deleteSavedFilter: owner-only. A saved filter is a personal preference;
//     ownership (userId === session user) is the check — even a global Admin
//     can't delete another user's saved filter through this action.
//   - listSavedFilters: returns only the caller's own rows, never another
//     user's — there is no "shared" or "team" saved filter concept.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthorizationError, requireUser } from "@/lib/permissions";
import type { SavedFilter } from "@/generated/prisma/client";
import { createSavedFilterSchema, deleteSavedFilterSchema } from "./saved-filter-schemas";

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

/** Saved filters only surface in the /explore filter bar. */
function revalidateExplore(): void {
  revalidatePath("/explore");
}

/** Save the current explorer filters under a name, scoped to the signed-in user. */
export async function createSavedFilter(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSavedFilterSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { name, query } = parsed.data;

  try {
    const user = await requireUser();

    const savedFilter = await prisma.savedFilter.create({
      data: { userId: user.id, name, query },
      select: { id: true },
    });

    revalidateExplore();
    return { ok: true, data: { id: savedFilter.id } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    return fail("Something went wrong. Please try again.");
  }
}

/** Delete a saved filter. Only its owner may delete it. */
export async function deleteSavedFilter(id: string): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteSavedFilterSchema.safeParse({ id });
  if (!parsed.success) return fail("Invalid input");

  try {
    const user = await requireUser();

    const savedFilter = await prisma.savedFilter.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, userId: true },
    });
    if (!savedFilter) return fail("Saved filter not found.");
    if (savedFilter.userId !== user.id) {
      return fail("You can only delete your own saved filters.");
    }

    await prisma.savedFilter.delete({ where: { id: savedFilter.id } });

    revalidateExplore();
    return { ok: true, data: { id: savedFilter.id } };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    return fail("Something went wrong. Please try again.");
  }
}

/** The signed-in user's own saved filters, most recent first. */
export async function listSavedFilters(): Promise<ActionResult<SavedFilter[]>> {
  try {
    const user = await requireUser();

    const savedFilters = await prisma.savedFilter.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return { ok: true, data: savedFilters };
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return mapped;
    return fail("Something went wrong. Please try again.");
  }
}
