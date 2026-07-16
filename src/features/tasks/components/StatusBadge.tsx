import type { TaskStatus } from "@/generated/prisma/client"

import { cn } from "@/lib/utils"

/**
 * Canonical status metadata — single source of truth for the functional
 * colours (CLAUDE.md: Todo = muted, In Progress = info, In Review = warning,
 * Done = success). Board column headers and the drawer dropdown reuse it.
 */
export const STATUS_META: Record<
  TaskStatus,
  { label: string; dotClass: string; chipClass: string }
> = {
  TODO: {
    label: "To Do",
    dotClass: "bg-muted-foreground",
    chipClass: "bg-muted-foreground/10 text-muted-foreground",
  },
  IN_PROGRESS: {
    label: "In Progress",
    dotClass: "bg-info",
    chipClass: "bg-info/10 text-info",
  },
  IN_REVIEW: {
    label: "In Review",
    dotClass: "bg-warning",
    chipClass: "bg-warning/10 text-warning",
  },
  DONE: {
    label: "Done",
    dotClass: "bg-success",
    chipClass: "bg-success/10 text-success",
  },
}

export const STATUS_ORDER = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "DONE",
] as const satisfies readonly TaskStatus[]

export function StatusBadge({
  status,
  className,
}: {
  status: TaskStatus
  className?: string
}) {
  const meta = STATUS_META[status]

  return (
    <span
      data-slot="status-badge"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap",
        meta.chipClass,
        className
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", meta.dotClass)}
        aria-hidden
      />
      {meta.label}
    </span>
  )
}
