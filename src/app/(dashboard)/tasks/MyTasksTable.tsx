"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown } from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { TaskStatus } from "@/generated/prisma/client"

import { updateTaskStatus } from "@/features/tasks/actions"
import {
  AssigneeAvatar,
  LabelChip,
  PriorityBadge,
  STATUS_META,
  STATUS_ORDER,
  StatusBadge,
  TypeIcon,
  formatDueDate,
} from "@/features/tasks/components"
// Not part of the public barrel (index.ts) — direct path import, same as
// Board/TaskCard/TaskDrawer use internally for the same overdue-tint need.
import { useClientNow } from "@/features/tasks/components/hooks"
import type { BoardTask } from "@/features/tasks/types"

export interface MyTasksGroup {
  project: { id: string; key: string; name: string }
  tasks: BoardTask[]
}

/** Chip-shaped dropdown trigger — mirrors the drawer/backlog inline pattern. */
function chipTriggerClass() {
  return "inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
}

/**
 * A single "my work" row rendered as a stacked card — the below-`sm` fallback
 * for the table (CLAUDE.md: cramped tables on phones become cards). Same
 * key/title/status/priority/assignee/due data as the table row; status and
 * priority render as static badges here rather than the table's inline
 * quick-change dropdown — card real estate favours a simple read + tap-to-open
 * over another layer of controls (same trade-off as the backlog's card).
 */
function MyTaskCard({
  task,
  now,
  onOpen,
}: {
  task: BoardTask
  now: Date | null
  onOpen: () => void
}) {
  const dueDate = task.dueDate ? new Date(task.dueDate) : null
  const isOverdue =
    dueDate !== null &&
    now !== null &&
    task.status !== "DONE" &&
    dueDate.getTime() < now.getTime()
  const overflowLabels = task.labels.length - 2

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen()
      }}
      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-surface p-3 outline-none focus-visible:bg-muted/50"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <TypeIcon type={task.type} className="size-3.5 shrink-0" />
            <span className="font-mono text-xs text-muted-foreground">
              {task.key}
            </span>
          </div>
          <p className="truncate text-sm text-foreground">{task.title}</p>
        </div>
        <AssigneeAvatar user={task.assignee} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={task.status} />
        <PriorityBadge priority={task.priority} />
        {task.labels.slice(0, 2).map((label) => (
          <LabelChip key={label.id} label={label} className="max-w-20" />
        ))}
        {overflowLabels > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            +{overflowLabels}
          </span>
        ) : null}
        {dueDate ? (
          <span
            className={cn(
              "ml-auto text-xs tabular-nums",
              isOverdue ? "text-danger" : "text-muted-foreground",
            )}
          >
            {formatDueDate(dueDate)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Grouped "my work" table — project key headers, backlog-style rows, inline
 * status quick-change. Row click navigates to the task's OWN project board
 * (`/projects/<projectId>?task=<taskId>`), a real page transition rather than
 * a same-page URL param update — this page isn't itself project-scoped.
 */
export function MyTasksTable({ groups }: { groups: MyTasksGroup[] }) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()
  // Client-only resolved clock — avoids an SSR/hydration mismatch on the
  // overdue tint (see features/tasks/components/hooks.ts).
  const now = useClientNow()

  function changeStatus(taskId: string, status: TaskStatus) {
    startTransition(async () => {
      const res = await updateTaskStatus(taskId, status)
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ project, tasks }) => (
        <div key={project.id} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {project.key}
            </span>
            <h2 className="text-sm font-medium text-foreground">
              {project.name}
            </h2>
          </div>

          {/* Table — `sm` and up; the cards below stand in on phones. Table
              first in the DOM so getByText/first() hits the visible row. */}
          <div className="hidden overflow-hidden rounded-xl border border-border sm:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-24">Key</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-36">Status</TableHead>
                  <TableHead className="w-32">Priority</TableHead>
                  <TableHead className="w-40">Labels</TableHead>
                  <TableHead className="w-24">Due</TableHead>
                  <TableHead className="w-14 text-right">Assignee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => {
                  const dueDate = task.dueDate ? new Date(task.dueDate) : null
                  const isOverdue =
                    dueDate !== null &&
                    now !== null &&
                    task.status !== "DONE" &&
                    dueDate.getTime() < now.getTime()
                  const overflowLabels = task.labels.length - 2

                  return (
                    <TableRow
                      key={task.id}
                      tabIndex={0}
                      onClick={() =>
                        router.push(`/projects/${project.id}?task=${task.id}`)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          router.push(
                            `/projects/${project.id}?task=${task.id}`,
                          )
                        }
                      }}
                      className="cursor-pointer outline-none focus-visible:bg-muted/50"
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {task.key}
                      </TableCell>
                      <TableCell className="max-w-80">
                        <span className="flex items-center gap-1.5">
                          <TypeIcon
                            type={task.type}
                            className="size-3.5 shrink-0"
                          />
                          <span className="truncate text-foreground">
                            {task.title}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
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
                                onClick={() => changeStatus(task.id, status)}
                              >
                                <span
                                  className={cn(
                                    "size-2 rounded-full",
                                    STATUS_META[status].dotClass,
                                  )}
                                  aria-hidden
                                />
                                {STATUS_META[status].label}
                                {status === task.status ? (
                                  <Check
                                    className="ml-auto size-3.5"
                                    aria-hidden
                                  />
                                ) : null}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell>
                        <PriorityBadge priority={task.priority} />
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-40 flex-wrap items-center gap-1">
                          {task.labels.slice(0, 2).map((label) => (
                            <LabelChip
                              key={label.id}
                              label={label}
                              className="max-w-20"
                            />
                          ))}
                          {overflowLabels > 0 ? (
                            <span className="text-[11px] text-muted-foreground">
                              +{overflowLabels}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {dueDate ? (
                          <span
                            className={cn(
                              "text-xs tabular-nums",
                              isOverdue
                                ? "text-danger"
                                : "text-muted-foreground",
                            )}
                          >
                            {formatDueDate(dueDate)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex justify-end">
                          <AssigneeAvatar user={task.assignee} />
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Stacked cards below `sm` — the table above cramps on phones. */}
          <div className="flex flex-col gap-2 sm:hidden">
            {tasks.map((task) => (
              <MyTaskCard
                key={task.id}
                task={task}
                now={now}
                onOpen={() =>
                  router.push(`/projects/${project.id}?task=${task.id}`)
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
