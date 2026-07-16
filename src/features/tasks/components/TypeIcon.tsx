import { BookOpen, Bug, CheckSquare, type LucideIcon } from "lucide-react"

import type { TaskType } from "@/generated/prisma/client"

import { cn } from "@/lib/utils"

export const TYPE_META: Record<
  TaskType,
  { label: string; icon: LucideIcon; className: string }
> = {
  TASK: { label: "Task", icon: CheckSquare, className: "text-muted-foreground" },
  BUG: { label: "Bug", icon: Bug, className: "text-danger" },
  STORY: { label: "Story", icon: BookOpen, className: "text-info" },
}

export function TypeIcon({
  type,
  className,
}: {
  type: TaskType
  className?: string
}) {
  const meta = TYPE_META[type]
  const Icon = meta.icon

  return (
    <Icon
      role="img"
      aria-label={meta.label}
      className={cn("size-4 shrink-0", meta.className, className)}
    />
  )
}
