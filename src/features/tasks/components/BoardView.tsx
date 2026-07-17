"use client"

import * as React from "react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

import type { TaskStatus } from "@/generated/prisma/client"

import { createTask, moveTask } from "../actions"
import type { BoardTask, TaskMoveEvent } from "../types"
import { Board } from "./Board"

export interface BoardViewProps {
  tasks: BoardTask[]
  /** VIEWER read-only mode: dragging is off, cards stay clickable. */
  disabled?: boolean
}

/**
 * Client wrapper around the presentational `Board`: turns a drop into a
 * `moveTask` Server Action call (optimistic — the Board already applied the
 * move locally; a failure toasts and `router.refresh()`s to resync truth), a
 * card click into the URL-driven drawer (`?view=board&task=<id>`) per the
 * locked architecture decision (selected task lives in the URL), and a
 * per-column quick-add submit into a `createTask` call scoped to that
 * column's status (refreshing on success so the new card appears — quick-add
 * has no local optimistic copy the way drags do).
 *
 * `projectId` isn't passed as a prop (the page only renders board tasks); it
 * is read from the `/projects/[projectId]` route segment via `useParams`,
 * same value the server component resolved to fetch `tasks`.
 */
export function BoardView({ tasks, disabled = false }: BoardViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { projectId } = useParams<{ projectId: string }>()
  const [, startTransition] = React.useTransition()

  function handleTaskMove(event: TaskMoveEvent) {
    startTransition(async () => {
      const res = await moveTask(event)
      if (!res.ok) {
        toast.error(res.error)
        router.refresh()
      }
    })
  }

  function handleTaskClick(taskId: string) {
    router.replace(`${pathname}?view=board&task=${taskId}`, { scroll: false })
  }

  function handleQuickAdd(status: TaskStatus, title: string): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const res = await createTask({ projectId, title, status })
        if (res.ok) {
          router.refresh()
          resolve(true)
        } else {
          toast.error(res.error)
          resolve(false)
        }
      })
    })
  }

  return (
    <Board
      tasks={tasks}
      onTaskMove={handleTaskMove}
      onTaskClick={handleTaskClick}
      onQuickAdd={disabled ? undefined : handleQuickAdd}
      disabled={disabled}
      className="h-full"
    />
  )
}
