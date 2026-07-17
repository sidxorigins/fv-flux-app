"use client"

import * as React from "react"
import { CalendarDays, Check, ChevronDown, Tag, X } from "lucide-react"

import type {
  Label as ProjectLabel,
  TaskPriority,
  TaskStatus,
  TaskType,
  User,
} from "@/generated/prisma/client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import { TypeIcon, TYPE_META } from "./TypeIcon"

type DrawerMember = Pick<User, "id" | "name" | "username" | "avatarKey">

const TYPE_ORDER = ["TASK", "BUG", "STORY"] as const satisfies readonly TaskType[]

/** Format a Date as the yyyy-mm-dd a native <input type="date"> expects. */
function toDateInputValue(date: Date | null): string {
  if (!date) return ""
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export type TaskDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: BoardTask | null
  /** Named content slots — wired up by the caller later. */
  description?: React.ReactNode
  attachments?: React.ReactNode
  comments?: React.ReactNode
  activity?: React.ReactNode
  /** Project members offered by the assignee editor. */
  members?: DrawerMember[]
  /** All labels on the project, offered by the label editor. */
  projectLabels?: ProjectLabel[]
  /** When provided, the status chip becomes a dropdown. */
  onStatusChange?: (status: TaskStatus) => void
  /** When provided, the priority chip becomes a dropdown. */
  onPriorityChange?: (priority: TaskPriority) => void
  /** When provided, the type icon becomes a dropdown. */
  onTypeChange?: (type: TaskType) => void
  /** When provided, the assignee chip becomes a dropdown. */
  onAssigneeChange?: (assigneeId: string | null) => void
  /** When provided, the due date becomes editable. `null` clears it. */
  onDueDateChange?: (date: string | null) => void
  /** When provided, labels become editable. */
  onLabelsChange?: (labelIds: string[]) => void
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
  members,
  projectLabels,
  onStatusChange,
  onPriorityChange,
  onTypeChange,
  onAssigneeChange,
  onDueDateChange,
  onLabelsChange,
}: TaskDrawerProps) {
  // Resolved on the client only so SSR and first client paint agree (the
  // overdue tint only ever upgrades after hydration).
  const now = useClientNow()
  const selectedLabelIds = new Set((task?.labels ?? []).map((l) => l.id))

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
                  {onTypeChange ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={chipTriggerClass()}
                        aria-label="Change type"
                      >
                        <TypeIcon type={task.type} />
                        <ChevronDown
                          className="size-3 text-muted-foreground"
                          aria-hidden
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-36">
                        {TYPE_ORDER.map((type) => (
                          <DropdownMenuItem
                            key={type}
                            onClick={() => onTypeChange(type)}
                          >
                            <TypeIcon type={type} />
                            {TYPE_META[type].label}
                            {type === task.type ? (
                              <Check className="ml-auto size-3.5" aria-hidden />
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <TypeIcon type={task.type} />
                  )}
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

                  {onAssigneeChange ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(chipTriggerClass(), "gap-1.5")}
                        aria-label="Change assignee"
                      >
                        <AssigneeAvatar user={task.assignee} />
                        <span className="text-sm text-foreground">
                          {task.assignee?.name ?? (
                            <span className="text-muted-foreground">
                              Unassigned
                            </span>
                          )}
                        </span>
                        <ChevronDown
                          className="size-3 text-muted-foreground"
                          aria-hidden
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-72 w-52 overflow-y-auto">
                        <DropdownMenuItem
                          onClick={() => onAssigneeChange(null)}
                        >
                          <span className="text-muted-foreground">
                            Unassigned
                          </span>
                          {!task.assignee ? (
                            <Check className="ml-auto size-3.5" aria-hidden />
                          ) : null}
                        </DropdownMenuItem>
                        {(members ?? []).map((member) => (
                          <DropdownMenuItem
                            key={member.id}
                            onClick={() => onAssigneeChange(member.id)}
                          >
                            <AssigneeAvatar user={member} />
                            <span className="truncate">{member.name}</span>
                            {task.assignee?.id === member.id ? (
                              <Check
                                className="ml-auto size-3.5"
                                aria-hidden
                              />
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
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
                  )}

                  {onDueDateChange ? (
                    <Popover>
                      <PopoverTrigger
                        className={cn(
                          chipTriggerClass(),
                          "gap-1 text-sm tabular-nums",
                          isOverdue ? "text-danger" : "text-muted-foreground"
                        )}
                        aria-label="Change due date"
                      >
                        <CalendarDays className="size-3.5" aria-hidden />
                        {dueDate ? formatDueDate(dueDate) : "Set due date"}
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-3">
                        <div className="flex flex-col gap-2">
                          <Input
                            type="date"
                            defaultValue={toDateInputValue(dueDate)}
                            onChange={(e) =>
                              onDueDateChange(e.target.value || null)
                            }
                          />
                          {dueDate ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onDueDateChange(null)}
                            >
                              Clear due date
                            </Button>
                          ) : null}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : dueDate ? (
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

                {onLabelsChange ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {task.labels.map((label) => (
                      <LabelChip key={label.id} label={label} />
                    ))}
                    <Popover>
                      <PopoverTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Edit labels"
                            className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground"
                          />
                        }
                      >
                        <Tag className="size-3" aria-hidden />
                        {task.labels.length > 0 ? "Edit" : "Add labels"}
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2">
                        {(projectLabels ?? []).length > 0 ? (
                          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                            {(projectLabels ?? []).map((label) => (
                              <label
                                key={label.id}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm text-foreground hover:bg-surface-raised"
                              >
                                <Checkbox
                                  checked={selectedLabelIds.has(label.id)}
                                  onCheckedChange={() => {
                                    const next = new Set(selectedLabelIds)
                                    if (next.has(label.id)) next.delete(label.id)
                                    else next.add(label.id)
                                    onLabelsChange([...next])
                                  }}
                                />
                                <span
                                  className="size-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: label.color }}
                                  aria-hidden
                                />
                                <span className="truncate">{label.name}</span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <p className="px-1.5 py-1 text-xs text-muted-foreground">
                            No labels on this project yet.
                          </p>
                        )}
                      </PopoverContent>
                    </Popover>
                  </div>
                ) : task.labels.length > 0 ? (
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
