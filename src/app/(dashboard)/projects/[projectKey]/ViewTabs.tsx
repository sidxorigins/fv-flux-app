import Link from "next/link"

import { cn } from "@/lib/utils"
import { projectPath } from "@/features/tasks/share"

/**
 * Board/Backlog switcher rendered as plain links driven by `?view=`, not
 * client tab state — the URL is the single source of truth so the tab
 * selection is shareable/bookmarkable and works with `notFound`/back-forward
 * nav for free. Server-compatible (no "use client").
 *
 * Takes the project KEY (not the cuid) so these links land directly on the
 * canonical `/projects/<KEY>` URL rather than round-tripping through the
 * cuid redirect on every tab click.
 */
export function ViewTabs({
  projectKey,
  view,
}: {
  projectKey: string
  view: "board" | "backlog" | "time"
}) {
  const tabClass = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none",
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    )

  return (
    <div
      role="tablist"
      aria-label="Project view"
      className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-[3px]"
    >
      <Link
        href={`${projectPath(projectKey)}?view=board`}
        role="tab"
        aria-selected={view === "board"}
        className={tabClass(view === "board")}
      >
        Board
      </Link>
      <Link
        href={`${projectPath(projectKey)}?view=backlog`}
        role="tab"
        aria-selected={view === "backlog"}
        className={tabClass(view === "backlog")}
      >
        Backlog
      </Link>
      <Link
        href={`${projectPath(projectKey)}?view=time`}
        role="tab"
        aria-selected={view === "time"}
        className={tabClass(view === "time")}
      >
        Time
      </Link>
    </div>
  )
}
