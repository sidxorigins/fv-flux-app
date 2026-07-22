"use client"

import * as React from "react"
import {
  CalendarDays,
  GitBranch,
  MessageSquare,
  Paperclip,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

import { formatDueDate } from "../format"
import type { BoardTask } from "../types"
import { AssigneeAvatar } from "./AssigneeAvatar"
import { CopyTaskLink } from "./CopyTaskLink"
import { LabelChip } from "./LabelChip"
import { PriorityBadge } from "./PriorityBadge"
import { TypeIcon } from "./TypeIcon"

// formatDueDate lives in a server-safe module (../format) so Server Components
// (e.g. /explore results) can call it — a fn exported from this "use client"
// file cannot. TaskCard imports it above for its own rendering use.
const MAX_VISIBLE_LABELS = 2

function MetaCount({
  icon: Icon,
  count,
  label,
}: {
  icon: LucideIcon
  count: number
  label: string
}) {
  return (
    <span
      className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
      aria-label={`${count} ${label}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {count}
    </span>
  )
}

export type TaskCardProps = React.ComponentProps<"div"> & {
  task: BoardTask
  /**
   * Fired on click or Enter. Kept separate from `onClick` so dnd listeners
   * spread onto the card never collide with the open action.
   */
  onOpen?: () => void
  /**
   * Reference time for overdue highlighting. Pass `null` (e.g. before the
   * client clock is known) to render due dates in the neutral muted style —
   * this avoids SSR/client hydration mismatches around midnight/timezones.
   */
  now?: Date | null
  /** Source card while a drag is in flight — dimmed in place. */
  dragging?: boolean
  /** Lifted copy rendered inside DragOverlay. */
  overlay?: boolean
}

export function TaskCard({
  task,
  onOpen,
  now = null,
  dragging = false,
  overlay = false,
  className,
  onClick,
  onKeyDown,
  ...props
}: TaskCardProps) {
  const visibleLabels = task.labels.slice(0, MAX_VISIBLE_LABELS)
  const overflowCount = task.labels.length - visibleLabels.length

  const dueDate = task.dueDate ? new Date(task.dueDate) : null
  const isOverdue =
    dueDate !== null &&
    now !== null &&
    task.status !== "DONE" &&
    dueDate.getTime() < now.getTime()

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    onClick?.(event)
    if (event.defaultPrevented) return
    onOpen?.()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Let the dnd keyboard sensor (spread in via listeners) see the event
    // first — Space picks up / drops; Enter opens the task.
    onKeyDown?.(event)
    if (event.defaultPrevented || dragging) return
    if (event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault()
      onOpen?.()
    }
  }

  return (
    <div
      data-slot="task-card"
      className={cn(
        "group/card flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-left",
        "transition-colors duration-150 hover:bg-surface-raised motion-reduce:transition-none",
        "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        dragging && "opacity-40",
        overlay &&
          "scale-[1.02] cursor-grabbing bg-surface-raised shadow-xl shadow-black/40",
        className
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {/* Top row: type + key, due date on the right */}
      <div className="flex items-center gap-1.5">
        <TypeIcon type={task.type} className="size-3.5" />
        <span className="truncate font-mono text-xs text-muted-foreground">
          {task.key}
        </span>
        {dueDate ? (
          <span
            className={cn(
              "ml-auto flex shrink-0 items-center gap-1 text-[11px] tabular-nums",
              isOverdue ? "text-danger" : "text-muted-foreground"
            )}
            aria-label={`Due ${formatDueDate(dueDate)}${isOverdue ? ", overdue" : ""}`}
          >
            <CalendarDays className="size-3 shrink-0" aria-hidden />
            {formatDueDate(dueDate)}
          </span>
        ) : null}
        <CopyTaskLink
          projectId={task.projectId}
          taskId={task.id}
          className={cn(
            "-my-1 -mr-1 size-6 opacity-0 transition-opacity",
            "group-hover/card:opacity-100 focus-visible:opacity-100",
            "motion-reduce:transition-none",
            !dueDate && "ml-auto",
          )}
        />
      </div>

      {/* Title — max 2 lines, always readable (no strikethrough on DONE) */}
      <p className="line-clamp-2 text-sm leading-snug font-medium text-foreground">
        {task.title}
      </p>

      {/* Bottom row: priority + labels, then counts + assignee */}
      <div className="flex items-center gap-1.5">
        <PriorityBadge priority={task.priority} />
        {visibleLabels.map((label) => (
          <LabelChip key={label.id} label={label} className="max-w-24" />
        ))}
        {overflowCount > 0 ? (
          <span
            className="text-[11px] text-muted-foreground"
            aria-label={`${overflowCount} more labels`}
          >
            +{overflowCount}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {task.subtaskCount ? (
            <MetaCount
              icon={GitBranch}
              count={task.subtaskCount}
              label="subtasks"
            />
          ) : null}
          {task.commentCount ? (
            <MetaCount
              icon={MessageSquare}
              count={task.commentCount}
              label="comments"
            />
          ) : null}
          {task.attachmentCount ? (
            <MetaCount
              icon={Paperclip}
              count={task.attachmentCount}
              label="attachments"
            />
          ) : null}
          <AssigneeAvatar user={task.assignee} />
        </span>
      </div>
    </div>
  )
}
