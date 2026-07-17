"use client"

import * as React from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import type { TaskStatus } from "@/generated/prisma/client"

import { cn } from "@/lib/utils"

import type { BoardTask, TaskMoveEvent } from "../types"
import { useClientNow, usePrefersReducedMotion } from "./hooks"
import { STATUS_META, STATUS_ORDER } from "./StatusBadge"
import { TaskCard } from "./TaskCard"

type ColumnMap = Record<TaskStatus, BoardTask[]>

function buildColumns(tasks: BoardTask[]): ColumnMap {
  const columns: ColumnMap = {
    TODO: [],
    IN_PROGRESS: [],
    IN_REVIEW: [],
    DONE: [],
  }
  for (const task of [...tasks].sort((a, b) => a.position - b.position)) {
    columns[task.status]?.push(task)
  }
  return columns
}

export type BoardProps = {
  tasks: BoardTask[]
  onTaskMove: (event: TaskMoveEvent) => void
  onTaskClick: (taskId: string) => void
  /** VIEWER read-only mode: dragging is off, cards remain clickable. */
  disabled?: boolean
  /** Optional reference time for overdue highlighting (see TaskCard). */
  now?: Date
  className?: string
}

/**
 * Kanban board. Owns an optimistic copy of the column ordering: drops apply
 * instantly to local state and `onTaskMove` reports the move (target status +
 * neighbour ids); whenever `tasks` changes the board resyncs to the parent's
 * truth.
 */
export function Board({
  tasks,
  onTaskMove,
  onTaskClick,
  disabled = false,
  now,
  className,
}: BoardProps) {
  const [columns, setColumns] = React.useState<ColumnMap>(() =>
    buildColumns(tasks)
  )
  const [activeTask, setActiveTask] = React.useState<BoardTask | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const clientNow = useClientNow(now)

  // Parent owns truth — resync the optimistic state whenever props change
  // (render-phase state adjustment per react.dev "You Might Not Need an
  // Effect", so there's no extra effect-driven render cascade).
  const [syncedTasks, setSyncedTasks] = React.useState(tasks)
  if (syncedTasks !== tasks) {
    setSyncedTasks(tasks)
    setColumns(buildColumns(tasks))
  }

  const sensors = useSensors(
    // 6px activation distance so plain clicks never start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks up / moves are arrows / Space or Enter drops. Enter on a
    // resting card is reserved for opening it (see TaskCard.handleKeyDown).
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
    })
  )

  const findColumn = React.useCallback(
    (id: UniqueIdentifier): TaskStatus | null => {
      const key = String(id)
      if ((STATUS_ORDER as readonly string[]).includes(key)) {
        return key as TaskStatus
      }
      for (const status of STATUS_ORDER) {
        if (columns[status].some((task) => task.id === key)) return status
      }
      return null
    },
    [columns]
  )

  function revert() {
    setColumns(buildColumns(tasks))
  }

  function handleDragStart({ active }: DragStartEvent) {
    const status = findColumn(active.id)
    const task = status
      ? (columns[status].find((t) => t.id === String(active.id)) ?? null)
      : null
    setActiveTask(task)
  }

  // Cross-column moves happen live while dragging so the target column's
  // sortable context previews the insertion gap (standard dnd-kit
  // multi-container pattern). Same-column reordering is left to dnd-kit's
  // own transforms and finalised on drop.
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return
    const from = findColumn(active.id)
    const to = findColumn(over.id)
    if (!from || !to || from === to) return

    const activeId = String(active.id)
    const overId = String(over.id)

    setColumns((prev) => {
      const fromItems = prev[from]
      const toItems = prev[to]
      const activeIndex = fromItems.findIndex((t) => t.id === activeId)
      if (activeIndex === -1) return prev

      const overIndex = toItems.findIndex((t) => t.id === overId)
      let newIndex: number
      if (overIndex === -1) {
        newIndex = toItems.length
      } else {
        const translated = active.rect.current.translated
        const isBelowOverItem =
          translated !== null &&
          translated.top > over.rect.top + over.rect.height / 2
        newIndex = overIndex + (isBelowOverItem ? 1 : 0)
      }

      const moving = fromItems[activeIndex]
      return {
        ...prev,
        [from]: fromItems.filter((t) => t.id !== activeId),
        [to]: [...toItems.slice(0, newIndex), moving, ...toItems.slice(newIndex)],
      }
    })
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null)
    const activeId = String(active.id)

    if (!over) {
      revert()
      return
    }

    const from = findColumn(active.id)
    const to = findColumn(over.id)
    if (!from || !to) {
      revert()
      return
    }

    // Normally dragOver has already moved the card into the target column;
    // finalise defensively in case the last over event was missed.
    let working = columns
    if (from !== to) {
      const moving = columns[from].find((t) => t.id === activeId)
      if (!moving) {
        revert()
        return
      }
      working = {
        ...columns,
        [from]: columns[from].filter((t) => t.id !== activeId),
        [to]: [...columns[to], moving],
      }
    }

    const items = working[to]
    const oldIndex = items.findIndex((t) => t.id === activeId)
    if (oldIndex === -1) {
      revert()
      return
    }

    const overIndex =
      String(over.id) === to
        ? items.length - 1
        : items.findIndex((t) => t.id === String(over.id))
    const newIndex = overIndex === -1 ? items.length - 1 : overIndex

    const reordered = arrayMove(items, oldIndex, newIndex)
    setColumns({ ...working, [to]: reordered })

    const finalIndex = reordered.findIndex((t) => t.id === activeId)
    const beforeTaskId = finalIndex > 0 ? reordered[finalIndex - 1].id : null
    const afterTaskId =
      finalIndex < reordered.length - 1 ? reordered[finalIndex + 1].id : null

    // Skip the callback when the card landed exactly where it started.
    const originalTask = tasks.find((t) => t.id === activeId)
    if (originalTask && originalTask.status === to) {
      const originalItems = buildColumns(tasks)[to]
      const originalIndex = originalItems.findIndex((t) => t.id === activeId)
      const originalBefore =
        originalIndex > 0 ? originalItems[originalIndex - 1].id : null
      const originalAfter =
        originalIndex < originalItems.length - 1
          ? originalItems[originalIndex + 1].id
          : null
      if (originalBefore === beforeTaskId && originalAfter === afterTaskId) {
        return
      }
    }

    onTaskMove({ taskId: activeId, toStatus: to, beforeTaskId, afterTaskId })
  }

  function handleDragCancel() {
    setActiveTask(null)
    revert()
  }

  return (
    <DndContext
      id="board-dnd"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={cn("flex h-full min-h-0 gap-3 overflow-x-auto", className)}>
        {STATUS_ORDER.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={columns[status]}
            disabled={disabled}
            onTaskClick={onTaskClick}
            now={clientNow}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>
      {/* Lifted copy of the dragged card — transform/opacity only. */}
      <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
        {activeTask ? (
          <TaskCard task={activeTask} overlay now={clientNow} />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumn({
  status,
  tasks,
  disabled,
  onTaskClick,
  now,
  reducedMotion,
}: {
  status: TaskStatus
  tasks: BoardTask[]
  disabled: boolean
  onTaskClick: (taskId: string) => void
  now: Date | null
  reducedMotion: boolean
}) {
  // Columns are droppable themselves so empty columns accept drops.
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled })
  const meta = STATUS_META[status]

  return (
    <section
      aria-label={`${meta.label}: ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
      className="flex h-full min-h-0 w-72 shrink-0 flex-col rounded-xl border border-border bg-surface lg:w-auto lg:min-w-0 lg:flex-1"
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className={cn("size-2 shrink-0 rounded-full", meta.dotClass)}
          aria-hidden
        />
        <h3 className="text-xs font-medium tracking-wider text-foreground uppercase">
          {meta.label}
        </h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </header>
      <div
        ref={setNodeRef}
        className="min-h-0 flex-1 overflow-y-auto p-2 pt-0.5"
      >
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.length === 0 ? (
            <div
              className={cn(
                "flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground",
                "transition-colors duration-150 motion-reduce:transition-none",
                isOver && "border-primary/50 text-foreground"
              )}
            >
              {disabled ? "No tasks" : "Drop tasks here"}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  disabled={disabled}
                  onTaskClick={onTaskClick}
                  now={now}
                  reducedMotion={reducedMotion}
                />
              ))}
            </div>
          )}
        </SortableContext>
      </div>
    </section>
  )
}

function SortableTaskCard({
  task,
  disabled,
  onTaskClick,
  now,
  reducedMotion,
}: {
  task: BoardTask
  disabled: boolean
  onTaskClick: (taskId: string) => void
  now: Date | null
  reducedMotion: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled })

  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      now={now}
      dragging={isDragging}
      onOpen={() => onTaskClick(task.id)}
      style={{
        // dnd-kit owns the drag physics — transform/transition only.
        transform: CSS.Transform.toString(transform),
        transition: reducedMotion ? undefined : transition,
      }}
      {...attributes}
      {...listeners}
    />
  )
}
