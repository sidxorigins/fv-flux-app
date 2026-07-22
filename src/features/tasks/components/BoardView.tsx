"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

import type { TaskStatus } from "@/generated/prisma/client"

import { createTask, moveTask } from "../actions"
import type { BoardTask, TaskMoveEvent } from "../types"
import { Board } from "./Board"

export interface BoardViewProps {
  tasks: BoardTask[]
  /** The project's cuid (not its key) — the route segment is now the project
   * KEY, but `createTask` needs the real id, so the server component passes
   * its already-resolved `projectId` down explicitly. */
  projectId: string
  /** VIEWER read-only mode: dragging is off, cards stay clickable. */
  disabled?: boolean
}

/**
 * Client wrapper around the presentational `Board`: turns a drop into a
 * `moveTask` Server Action call (optimistic — the Board already applied the
 * move locally; a failure toasts and `router.refresh()`s to resync truth), a
 * card click into the URL-driven drawer (`?view=board&task=<key>`) per the
 * locked architecture decision (selected task lives in the URL), and a
 * per-column quick-add submit into a `createTask` call scoped to that
 * column's status (refreshing on success so the new card appears — quick-add
 * has no local optimistic copy the way drags do).
 */
export function BoardView({ tasks, projectId, disabled = false }: BoardViewProps) {
  const router = useRouter()
  const pathname = usePathname()
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

  function handleTaskClick(taskKey: string) {
    router.replace(`${pathname}?view=board&task=${taskKey}`, { scroll: false })
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
