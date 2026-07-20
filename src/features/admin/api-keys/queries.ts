import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  actorName: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** List keys (never the hash). Admin only. */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  await requireAdmin();
  const rows = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    actorName: r.user.name,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
    createdAt: r.createdAt,
  }));
}
