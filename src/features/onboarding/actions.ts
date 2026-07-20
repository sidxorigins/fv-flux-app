"use server";

import { AuthorizationError, requireUser } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Mark the guided tour complete for the SIGNED-IN user (own row only; no id input).
 * Idempotent — a no-op if already completed. Best-effort from the client.
 */
export async function completeTour(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (user.tourCompletedAt) return { ok: true };
    await prisma.user.update({
      where: { id: user.id },
      data: { tourCompletedAt: new Date() },
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthorizationError) return { ok: false, error: "Not signed in." };
    return { ok: false, error: "Something went wrong." };
  }
}
