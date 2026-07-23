import Link from "next/link";

import type { ProjectRole } from "@/generated/prisma/enums";
import type { ProjectTile } from "@/features/dashboard/queries";
import { projectPath } from "@/features/tasks/share";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<ProjectRole, string> = {
  MANAGER: "Manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

/** Segment order + functional colours for the thin status bar. */
const SEGMENTS = [
  { key: "done", className: "bg-success" },
  { key: "inReview", className: "bg-warning" },
  { key: "inProgress", className: "bg-info" },
  { key: "todo", className: "bg-surface-raised" },
] as const;

/**
 * Project shortcuts rail. auto-fit + capped tile width: one tile doesn't
 * strand a mostly-empty 4-column row, many tiles wrap naturally. Solid
 * surface (glass is reserved for panel chrome); CSS-only hover raise.
 */
export function ProjectTiles({ tiles }: { tiles: ProjectTile[] }) {
  if (tiles.length === 0) return null;

  return (
    <ul className="grid justify-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,300px))]">
      {tiles.map((tile) => {
        const total =
          tile.statusCounts.todo +
          tile.statusCounts.inProgress +
          tile.statusCounts.inReview +
          tile.statusCounts.done;
        return (
          <li key={tile.id}>
            <Link
              href={projectPath(tile.key)}
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
              {total > 0 ? (
                <div
                  aria-hidden
                  className="flex h-1 w-full overflow-hidden rounded-full"
                >
                  {SEGMENTS.map(({ key, className }) =>
                    tile.statusCounts[key] > 0 ? (
                      <span
                        key={key}
                        className={className}
                        style={{ width: `${(tile.statusCounts[key] / total) * 100}%` }}
                      />
                    ) : null,
                  )}
                </div>
              ) : null}
              <p className="text-muted-foreground mt-auto text-xs">
                <span className="text-foreground font-semibold tabular-nums">
                  {tile.openTaskCount}
                </span>{" "}
                open {tile.openTaskCount === 1 ? "task" : "tasks"}
                {tile.statusCounts.done > 0 ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {tile.statusCounts.done} done
                  </span>
                ) : null}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
