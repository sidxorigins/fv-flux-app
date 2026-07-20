"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { AuthorizationError, requireAdmin } from "@/lib/permissions";
import { generateApiKey } from "@/lib/api-key";
import {
  createApiKeySchema,
  type ApiKeyActionResult,
  type CreateApiKeyInput,
} from "./schemas";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
function mapAuthError(err: unknown): { ok: false; error: string } | null {
  if (err instanceof AuthorizationError) {
    return fail(
      err.code === "FORBIDDEN"
        ? "You don't have permission to do that."
        : "You must be signed in.",
    );
  }
  return null;
}

/** Mint an API key for an actor user. Admin only. Returns the plaintext key ONCE. */
export async function createApiKey(
  input: CreateApiKeyInput,
): Promise<ApiKeyActionResult<{ id: string; key: string; prefix: string }>> {
  try {
    const admin = await requireAdmin();
    const parsed = createApiKeySchema.safeParse(input);
    if (!parsed.success)
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
    const actor = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true },
    });
    if (!actor) return fail("That user doesn't exist.");

    const { key, prefix, keyHash } = generateApiKey();
    const created = await prisma.$transaction(async (tx) => {
      const created = await tx.apiKey.create({
        data: {
          name: parsed.data.name,
          prefix,
          keyHash,
          userId: actor.id,
          createdById: admin.id,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "api_key.created",
          targetType: "ApiKey",
          targetId: created.id,
          metadata: { name: parsed.data.name, prefix, actorUserId: actor.id }, // never the raw key
        },
      });
      return created;
    });
    revalidatePath("/admin/api-keys", "page");
    return { ok: true, data: { id: created.id, key, prefix } };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}

/** Revoke a key. Admin only. */
export async function revokeApiKey(id: string): Promise<ApiKeyActionResult> {
  try {
    const admin = await requireAdmin();
    if (!id) return fail("Invalid input.");

    const existing = await prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, name: true, prefix: true, revokedAt: true },
    });
    if (!existing) return fail("API key not found.");
    if (existing.revokedAt) {
      // Already revoked — idempotent no-op, no duplicate audit entry.
      revalidatePath("/admin/api-keys", "page");
      return { ok: true };
    }

    await prisma.$transaction(async (tx) => {
      await tx.apiKey.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "api_key.revoked",
          targetType: "ApiKey",
          targetId: id,
          metadata: { name: existing.name, prefix: existing.prefix },
        },
      });
    });
    revalidatePath("/admin/api-keys", "page");
    return { ok: true };
  } catch (err) {
    return mapAuthError(err) ?? fail("Something went wrong.");
  }
}
