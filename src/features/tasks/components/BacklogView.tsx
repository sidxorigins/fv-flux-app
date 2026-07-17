"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, Check, ChevronDown } from "lucide-react"
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
import type { TaskPriority, TaskStatus } from "@/generated/prisma/client"

import { updateTask, updateTaskStatus } from "../actions"
// Type-only — fully erased at compile time (tsconfig `isolatedModules`), so this
// never pulls the Prisma-backed queries module into the client bundle. See
// BACKLOG_SORT_DEFAULT_DIR below for why the *values* have to be redeclared here.
import type { BacklogSortField } from "../queries"
import type { BoardTask } from "../types"
import { AssigneeAvatar } from "./AssigneeAvatar"
import { useClientNow } from "./hooks"
import { LabelChip } from "./LabelChip"
import { PRIORITY_META, PRIORITY_ORDER, PriorityBadge } from "./PriorityBadge"
import { STATUS_META, STATUS_ORDER, StatusBadge } from "./StatusBadge"
import { formatDueDate } from "./TaskCard"
import { TypeIcon } from "./TypeIcon"

/**
 * Mirrors BACKLOG_SORT_FIELDS / BACKLOG_SORT_DEFAULT_DIR in ../queries.ts.
 * Must stay in sync with that module — see the import note above for why this
 * can't just be imported directly. `satisfies` against the queries.ts type
 * means this file fails to typecheck if the two ever drift apart.
 */
const BACKLOG_SORT_FIELDS = [
  "key",
  "priority",
  "dueDate",
  "status",
  "updatedAt",
] as const satisfies readonly BacklogSortField[]

const SORT_DEFAULT_DIR: Record<BacklogSortField, "asc" | "desc"> = {
  key: "asc",
  priority: "desc",
  dueDate: "asc",
  status: "asc",
  updatedAt: "desc",
}

const SORT_LABELS: Record<BacklogSortField, string> = {
  key: "Key",
  priority: "Priority",
  dueDate: "Due",
  status: "Status",
  updatedAt: "Updated",
}

function isSortField(value: string | null): value is BacklogSortField {
  return (
    value !== null && (BACKLOG_SORT_FIELDS as readonly string[]).includes(value)
  )
}

const UPDATED_AT_DIVISIONS: {
  amount: number
  unit: Intl.RelativeTimeFormatUnit
}[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
]

/**
 * Relative "updated" label, resolved only once the client clock is known (see
 * useClientNow) so SSR and the first client render agree — falls back to the
 * same deterministic month/day format as due dates until then, exactly like
 * the overdue-tint logic below.
 */
function formatUpdatedAt(date: Date, now: Date | null): string {
  if (now === null) return formatDueDate(date)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  let duration = (date.getTime() - now.getTime()) / 1000
  for (const division of UPDATED_AT_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit)
    }
    duration /= division.amount
  }
  return formatDueDate(date)
}

export interface BacklogViewProps {
  tasks: BoardTask[]
  /** MEMBER+ — enables the inline status/priority quick-change dropdowns. */
  canEdit: boolean
}

/** Chip-shaped dropdown trigger — mirrors TaskDrawer's inline status/priority pattern. */
function chipTriggerClass() {
  return "inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
}

/**
 * Clickable column header for a sortable field. Reflects the active
 * sort/direction with an arrow icon and `aria-sort`, and hands the click off
 * to the caller — BacklogView owns the URL-param toggle logic.
 */
function SortableColumnHead({
  field,
  className,
  activeField,
  activeDir,
  onSort,
}: {
  field: BacklogSortField
  className?: string
  activeField: BacklogSortField | null
  activeDir: "asc" | "desc"
  onSort: (field: BacklogSortField) => void
}) {
  const active = activeField === field
  return (
    <TableHead
      className={className}
      aria-sort={active ? (activeDir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
        aria-label={`Sort by ${SORT_LABELS[field]}`}
      >
        {SORT_LABELS[field]}
        {active ? (
          activeDir === "asc" ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </TableHead>
  )
}

/**
 * Backlog table — client shell for interactions: row click opens the
 * URL-driven drawer (`?task=<id>`, preserving the current view + filters),
 * and (when `canEdit`) status/priority cells become inline quick-change
 * dropdowns backed by Server Actions. Data itself is server-fetched and
 * passed in — no client fetching layer.
 */
export function BacklogView({ tasks, canEdit }: BacklogViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = React.useTransition()
  // Resolved client-side only (server/first-paint render see `null`) so the
  // overdue tint never causes an SSR/hydration mismatch — see hooks.ts.
  const now = useClientNow()

  const sortParam = searchParams.get("sort")
  const currentSort = isSortField(sortParam) ? sortParam : null
  const dirParam = searchParams.get("dir")
  const currentDir: "asc" | "desc" =
    dirParam === "asc" || dirParam === "desc"
      ? dirParam
      : currentSort
        ? SORT_DEFAULT_DIR[currentSort]
        : "desc"

  // Toggles the URL's `sort`/`dir` params: a fresh column jumps to its sensible
  // default direction, clicking the already-active column flips it. Sorting
  // always drops `cursor` so pagination restarts from the first page — the same
  // "any filter change resets paging" rule TaskFilters applies to its params.
  function toggleSort(field: BacklogSortField) {
    const params = new URLSearchParams(searchParams.toString())
    const nextDir: "asc" | "desc" =
      currentSort === field
        ? currentDir === "asc"
          ? "desc"
          : "asc"
        : SORT_DEFAULT_DIR[field]
    params.set("sort", field)
    params.set("dir", nextDir)
    params.delete("cursor")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function openTask(taskId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("task", taskId)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function changeStatus(taskId: string, status: TaskStatus) {
    startTransition(async () => {
      const res = await updateTaskStatus(taskId, status)
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  function changePriority(taskId: string, priority: TaskPriority) {
    startTransition(async () => {
      const res = await updateTask({ taskId, priority })
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  if (tasks.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        No tasks match these filters.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableColumnHead
              field="key"
              className="w-24"
              activeField={currentSort}
              activeDir={currentDir}
              onSort={toggleSort}
            />
            <TableHead>Title</TableHead>
            <SortableColumnHead
              field="status"
              className="w-36"
              activeField={currentSort}
              activeDir={currentDir}
              onSort={toggleSort}
            />
            <SortableColumnHead
              field="priority"
              className="w-32"
              activeField={currentSort}
              activeDir={currentDir}
              onSort={toggleSort}
            />
            <TableHead className="w-40">Labels</TableHead>
            <SortableColumnHead
              field="dueDate"
              className="w-24"
              activeField={currentSort}
              activeDir={currentDir}
              onSort={toggleSort}
            />
            <SortableColumnHead
              field="updatedAt"
              className="w-24"
              activeField={currentSort}
              activeDir={currentDir}
              onSort={toggleSort}
            />
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
                onClick={() => openTask(task.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") openTask(task.id)
                }}
                className="cursor-pointer outline-none focus-visible:bg-muted/50"
              >
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {task.key}
                </TableCell>
                <TableCell className="max-w-80">
                  <span className="flex items-center gap-1.5">
                    <TypeIcon type={task.type} className="size-3.5 shrink-0" />
                    <span className="truncate text-foreground">
                      {task.title}
                    </span>
                  </span>
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  {canEdit ? (
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
                              <Check className="ml-auto size-3.5" aria-hidden />
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <StatusBadge status={task.status} />
                  )}
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  {canEdit ? (
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
                      <DropdownMenuContent className="w-36">
                        {PRIORITY_ORDER.map((priority) => {
                          const Icon = PRIORITY_META[priority].icon
                          return (
                            <DropdownMenuItem
                              key={priority}
                              onClick={() => changePriority(task.id, priority)}
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
                        isOverdue ? "text-danger" : "text-muted-foreground",
                      )}
                    >
                      {formatDueDate(dueDate)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatUpdatedAt(new Date(task.updatedAt), now)}
                  </span>
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
  )
}
