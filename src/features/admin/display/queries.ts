import "server-only";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

export interface WallBoardUser {
  id: string;
  name: string;
  username: string;
  globalRole: string;
  showOnWallBoard: boolean;
  /** Non-DONE assigned tasks — context for whether hiding someone loses
   * anything meaningful from the board. */
  openTasks: number;
}

/** Every active user plus their wall-board visibility. ADMIN-ONLY. */
export async function getWallBoardUsers(): Promise<WallBoardUser[]> {
  await requireAdmin();

  const [users, openCounts] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ showOnWallBoard: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        username: true,
        globalRole: true,
        showOnWallBoard: true,
      },
    }),
    prisma.task.groupBy({
      by: ["assigneeId"],
      where: { status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } },
      _count: { _all: true },
    }),
  ]);

  const openByUser = new Map(
    openCounts
      .filter((g) => g.assigneeId !== null)
      .map((g) => [g.assigneeId as string, g._count._all]),
  );

  return users.map((u) => ({
    ...u,
    openTasks: openByUser.get(u.id) ?? 0,
  }));
}
