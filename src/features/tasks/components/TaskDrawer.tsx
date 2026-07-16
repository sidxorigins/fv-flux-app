"use client"

import * as React from "react"
import { CalendarDays, Check, ChevronDown, X } from "lucide-react"

import type { TaskPriority, TaskStatus } from "@/generated/prisma/client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import type { BoardTask } from "../types"
import { AssigneeAvatar } from "./AssigneeAvatar"
import { useClientNow } from "./hooks"
import { LabelChip } from "./LabelChip"
import { PriorityBadge, PRIORITY_META, PRIORITY_ORDER } from "./PriorityBadge"
import { StatusBadge, STATUS_META, STATUS_ORDER } from "./StatusBadge"
import { formatDueDate } from "./TaskCard"
import { TypeIcon } from "./TypeIcon"

export type TaskDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: BoardTask | null
  /** Named content slots — wired up by the caller later. */
  description?: React.ReactNode
  attachments?: React.ReactNode
  comments?: React.ReactNode
  activity?: React.ReactNode
  /** When provided, the status chip becomes a dropdown. */
  onStatusChange?: (status: TaskStatus) => void
  /** When provided, the priority chip becomes a dropdown. */
  onPriorityChange?: (priority: TaskPriority) => void
}

function DrawerSection({
  title,
  emptyText,
  children,
}: {
  title: string
  emptyText: string
  children?: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {title}
        </h3>
        <Separator className="flex-1" />
      </div>
      {children ?? <p className="text-sm text-muted-foreground">{emptyText}</p>}
    </section>
  )
}

/** Chip-shaped dropdown trigger shared by the status/priority selectors. */
function chipTriggerClass() {
  return cn(
    "inline-flex items-center gap-1 rounded-md outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring/50"
  )
}

/**
 * Task detail drawer — shell only; description/comments/attachments/activity
 * arrive via slot props. Glass panel (the drawer is chrome per CLAUDE.md);
 * open/close animation is the Sheet's own transform/opacity transition.
 */
export function TaskDrawer({
  open,
  onOpenChange,
  task,
  description,
  attachments,
  comments,
  activity,
  onStatusChange,
  onPriorityChange,
}: TaskDrawerProps) {
  // Resolved on the client only so SSR and first client paint agree (the
  // overdue tint only ever upgrades after hydration).
  const now = useClientNow()

  const dueDate = task?.dueDate ? new Date(task.dueDate) : null
  const isOverdue =
    dueDate !== null &&
    now !== null &&
    task?.status !== "DONE" &&
    dueDate.getTime() < now.getTime()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(
          // Transparent shell with a gutter; the glass panel inside is the
          // visible drawer. Width: full on mobile, ~560px from sm up.
          "data-[side=right]:w-full data-[side=right]:sm:max-w-[584px]",
          "border-0 data-[side=right]:border-l-0 bg-transparent p-2 shadow-none sm:p-3",
          "motion-reduce:transition-none"
        )}
      >
        <div className="glass flex h-full min-h-0 flex-col overflow-hidden">
          {task ? (
            <>
              {/* Header */}
              <div className="flex flex-col gap-2 border-b border-border/60 px-5 pt-5 pb-4">
                <div className="flex items-center gap-2">
                  <TypeIcon type={task.type} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {task.key}
                  </span>
                  <SheetClose
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto text-muted-foreground"
                      />
                    }
                  >
                    <X />
                    <span className="sr-only">Close</span>
                  </SheetClose>
                </div>
                <SheetTitle className="text-lg leading-snug font-semibold text-foreground">
                  {task.title}
                </SheetTitle>

                {/* Meta row */}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
                  {onStatusChange ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={chipTriggerClass()}
                        aria-label="Change status"
                      >
                        <StatusBadge status={task.status} />
                        <ChevronDown
                          className="size-3 text-muted-foreground"
                          aria-hidden
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-40">
                        {STATUS_ORDER.map((status) => (
                          <DropdownMenuItem
                            key={status}
                            onClick={() => onStatusChange(status)}
                          >
                            <span
                              className={cn(
                                "size-2 rounded-full",
                                STATUS_META[status].dotClass
                              )}
                              aria-hidden
                            />
                            {STATUS_META[status].label}
                            {status === task.status ? (
                              <Check className="ml-auto size-3.5" aria-hidden />
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <StatusBadge status={task.status} />
                  )}

                  {onPriorityChange ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={chipTriggerClass()}
                        aria-label="Change priority"
                      >
                        <PriorityBadge priority={task.priority} />
                        <ChevronDown
                          className="size-3 text-muted-foreground"
                          aria-hidden
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-40">
                        {PRIORITY_ORDER.map((priority) => {
                          const Icon = PRIORITY_META[priority].icon
                          return (
                            <DropdownMenuItem
                              key={priority}
                              onClick={() => onPriorityChange(priority)}
                            >
                              <Icon aria-hidden />
                              {PRIORITY_META[priority].label}
                              {priority === task.priority ? (
                                <Check
                                  className="ml-auto size-3.5"
                                  aria-hidden
                                />
                              ) : null}
                            </DropdownMenuItem>
                          )
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <PriorityBadge priority={task.priority} />
                  )}

                  <span className="flex items-center gap-1.5">
                    <AssigneeAvatar user={task.assignee} />
                    <span className="text-sm text-foreground">
                      {task.assignee?.name ?? (
                        <span className="text-muted-foreground">
                          Unassigned
                        </span>
                      )}
                    </span>
                  </span>

                  {dueDate ? (
                    <span
                      className={cn(
                        "flex items-center gap-1 text-sm tabular-nums",
                        isOverdue ? "text-danger" : "text-muted-foreground"
                      )}
                      aria-label={`Due ${formatDueDate(dueDate)}${isOverdue ? ", overdue" : ""}`}
                    >
                      <CalendarDays className="size-3.5" aria-hidden />
                      {formatDueDate(dueDate)}
                    </span>
                  ) : null}
                </div>

                {task.labels.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {task.labels.map((label) => (
                      <LabelChip key={label.id} label={label} />
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Slot sections */}
              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
                <DrawerSection
                  title="Description"
                  emptyText="No description yet."
                >
                  {description}
                </DrawerSection>
                <DrawerSection title="Attachments" emptyText="No attachments.">
                  {attachments}
                </DrawerSection>
                <DrawerSection title="Comments" emptyText="No comments yet.">
                  {comments}
                </DrawerSection>
                <DrawerSection title="Activity" emptyText="No activity yet.">
                  {activity}
                </DrawerSection>
              </div>
            </>
          ) : (
            // Keep the dialog accessible even if opened without a task.
            <div className="flex h-full items-center justify-center p-5">
              <SheetTitle className="text-sm font-normal text-muted-foreground">
                No task selected
              </SheetTitle>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
