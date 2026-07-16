import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Minus,
  type LucideIcon,
} from "lucide-react"

import type { TaskPriority } from "@/generated/prisma/client"

import { cn } from "@/lib/utils"

/**
 * Priority metadata — LOW muted / MEDIUM info / HIGH warning / URGENT danger.
 * Icons follow the Jira convention (down = low, dash = medium, up = high)
 * so direction reads at a glance; URGENT gets the triangle.
 */
export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; icon: LucideIcon; chipClass: string }
> = {
  LOW: {
    label: "Low",
    icon: ArrowDown,
    chipClass: "bg-muted-foreground/10 text-muted-foreground",
  },
  MEDIUM: {
    label: "Medium",
    icon: Minus,
    chipClass: "bg-info/10 text-info",
  },
  HIGH: {
    label: "High",
    icon: ArrowUp,
    chipClass: "bg-warning/10 text-warning",
  },
  URGENT: {
    label: "Urgent",
    icon: AlertTriangle,
    chipClass: "bg-danger/10 text-danger",
  },
}

export const PRIORITY_ORDER = [
  "URGENT",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const satisfies readonly TaskPriority[]

export function PriorityBadge({
  priority,
  className,
}: {
  priority: TaskPriority
  className?: string
}) {
  const meta = PRIORITY_META[priority]
  const Icon = meta.icon

  return (
    <span
      data-slot="priority-badge"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap",
        meta.chipClass,
        className
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {meta.label}
    </span>
  )
}
