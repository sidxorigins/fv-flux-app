"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

import { moveTask } from "../actions"
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
 * move locally; a failure toasts and `router.refresh()`s to resync truth) and
 * a card click into the URL-driven drawer (`?view=board&task=<id>`), per the
 * locked architecture decision (selected task lives in the URL).
 */
export function BoardView({ tasks, disabled = false }: BoardViewProps) {
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

  function handleTaskClick(taskId: string) {
    router.replace(`${pathname}?view=board&task=${taskId}`, { scroll: false })
  }

  return (
    <Board
      tasks={tasks}
      onTaskMove={handleTaskMove}
      onTaskClick={handleTaskClick}
      disabled={disabled}
      className="h-full"
    />
  )
}
