// Saved view read queries. Server-only (DB + session). Mirrors tasks/queries.ts:
// `canViewProject` THROWS on no access (queries are consumed by Server Components →
// nearest error boundary), and its returned `user` scopes the read to the
// signed-in user's own saved views — nobody sees another user's saved filters.

import { prisma } from "@/lib/db";
import { canViewProject } from "@/lib/permissions";

export interface SavedViewSummary {
  id: string;
  name: string;
  query: string;
}

/** The signed-in user's saved backlog views for a project, alphabetised by name. */
export async function getSavedViews(projectId: string): Promise<SavedViewSummary[]> {
  const { user } = await canViewProject(projectId); // throws if not permitted

  return prisma.savedView.findMany({
    where: { projectId, userId: user.id },
    select: { id: true, name: true, query: true },
    orderBy: { name: "asc" },
  });
}
