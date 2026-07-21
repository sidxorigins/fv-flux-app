import Link from "next/link"
import { ArrowLeft, ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import {
  AssigneeAvatar,
  formatDueDate,
  PriorityBadge,
  StatusBadge,
} from "@/features/tasks/components"
import type { ExploreTasksPage } from "../queries"

export interface ExploreResultsProps {
  data: ExploreTasksPage
  /** Current filter querystring WITHOUT `page` — preserved on prev/next links. */
  baseQuery: string
}

function pageHref(baseQuery: string, page: number): string {
  const params = new URLSearchParams(baseQuery)
  if (page > 1) params.set("page", String(page))
  else params.delete("page")
  const qs = params.toString()
  return qs ? `/explore?${qs}` : "/explore"
}

/**
 * The Explorer's results table — mirrors BacklogView's table shell
 * (TableHead/TableRow + StatusBadge/PriorityBadge/AssigneeAvatar) but is
 * read-only and cross-project, so each row is a real `<Link>` into the
 * task's own project (opening the task drawer there via `?task=`) rather
 * than a client-side row click. The link is a "stretched" overlay — a single
 * `<Link className="absolute inset-0">` inside the first cell, positioned
 * against the `<tr>` (not the `<td>`) — so the whole row is one click/tap
 * target and keyboard-focusable stop, without nesting an `<a>` directly in
 * a `<tr>` (invalid HTML).
 */
export function ExploreResults({ data, baseQuery }: ExploreResultsProps) {
  const { tasks, total, page, pageSize } = data

  if (tasks.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        No tasks match these filters.
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasPrev = page > 1
  const hasNext = page < totalPages
  const rangeStart = (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-24">Key</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-20">Project</TableHead>
              <TableHead className="w-14">Assignee</TableHead>
              <TableHead className="w-36">Status</TableHead>
              <TableHead className="w-32">Priority</TableHead>
              <TableHead className="w-24">Due</TableHead>
              <TableHead className="w-20 text-right">Est. hrs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const dueDate = task.dueDate ? new Date(task.dueDate) : null
              return (
                <TableRow key={task.id} className="relative">
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    <Link
                      href={`/projects/${task.projectId}?task=${task.id}`}
                      className="absolute inset-0 z-10"
                      aria-label={`Open ${task.key} — ${task.title}`}
                    />
                    {task.key}
                  </TableCell>
                  <TableCell className="max-w-80 truncate text-foreground">
                    {task.title}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {task.projectKey}
                  </TableCell>
                  <TableCell>
                    <AssigneeAvatar user={task.assignee} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={task.status} />
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={task.priority} />
                  </TableCell>
                  <TableCell>
                    {dueDate ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatDueDate(dueDate)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {task.estimatedHours ?? "—"}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">
          {rangeStart}–{rangeEnd} of {total}
        </span>
        <div className="flex items-center gap-2">
          {hasPrev ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={pageHref(baseQuery, page - 1)} scroll={false} />}
            >
              <ArrowLeft />
              Prev
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <ArrowLeft />
              Prev
            </Button>
          )}
          {hasNext ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={pageHref(baseQuery, page + 1)} scroll={false} />}
            >
              Next
              <ArrowRight />
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
              <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
