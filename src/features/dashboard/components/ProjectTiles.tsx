import Link from "next/link";

import type { ProjectRole } from "@/generated/prisma/enums";
import type { ProjectTile } from "@/features/dashboard/queries";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<ProjectRole, string> = {
  MANAGER: "Manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

/**
 * Bento shortcuts into each project's board. Solid surface (glass is reserved
 * for the KPI/panel chrome); hover is a CSS-only raise — transform + colour,
 * 150ms, nothing that reflows.
 */
export function ProjectTiles({ tiles }: { tiles: ProjectTile[] }) {
  if (tiles.length === 0) return null;

  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <li key={tile.id}>
          <Link
            href={`/projects/${tile.id}`}
            className={cn(
              "group border-border bg-surface flex h-full flex-col gap-3 rounded-2xl border p-4",
              "transition-[transform,background-color] duration-150 motion-reduce:transition-none",
              "hover:bg-surface-raised hover:-translate-y-px motion-reduce:hover:translate-y-0",
              "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-xs font-medium">
                {tile.key}
              </span>
              <span className="text-muted-foreground ml-auto text-[11px]">
                {ROLE_LABEL[tile.role]}
              </span>
            </div>
            <p className="text-foreground truncate text-sm font-medium">
              {tile.name}
            </p>
            <p className="text-muted-foreground mt-auto text-xs">
              <span className="text-foreground font-semibold tabular-nums">
                {tile.openTaskCount}
              </span>{" "}
              open {tile.openTaskCount === 1 ? "task" : "tasks"}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
