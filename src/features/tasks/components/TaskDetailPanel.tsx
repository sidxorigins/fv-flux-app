"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { RichTextContent, RichTextEditor } from "@/components/editor"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
  Label as ProjectLabel,
  TaskPriority,
  TaskStatus,
  TaskType,
  User,
} from "@/generated/prisma/client"

import { AttachmentSection } from "@/features/attachments/components/AttachmentSection"
import type { AttachmentWithUploader } from "@/features/attachments/types"
import { CommentSection } from "@/features/comments/components/CommentSection"
import type { CommentWithAuthor } from "@/features/comments/types"
import { WatchToggle } from "@/features/notifications/components/WatchToggle"

import type { ActivityEntry } from "../activity"
import { createTask, deleteTask, updateTask, updateTaskStatus } from "../actions"
import type { TaskDetail } from "../queries"
import { ActivityList } from "./ActivityList"
import { StatusBadge } from "./StatusBadge"
import { TaskDrawer } from "./TaskDrawer"
import { TypeIcon } from "./TypeIcon"

type Member = Pick<User, "id" | "name" | "username" | "avatarKey">

export interface TaskDetailPanelProps {
  task: TaskDetail
  comments: CommentWithAuthor[]
  attachments: AttachmentWithUploader[]
  activity: ActivityEntry[]
  currentUserId: string
  /** Project members offered by the assignee editor. */
  members: Member[]
  /** All labels on the project, offered by the label editor. */
  projectLabels: ProjectLabel[]
  /** Whether the current user watches this task (drives the header toggle). */
  isWatching: boolean
  /** MEMBER+ on this project — edit description/status/priority, add subtasks. */
  canEdit: boolean
  /** MANAGER+ (or global Admin) — manage others' comments/attachments, delete any task. */
  canManage: boolean
}

/**
 * Client half of the URL-driven task drawer. The server page fetches
 * task + comments + attachments + activity for `?task=<id>` and renders this
 * with the data already in hand — no client fetching. Closing (X, overlay
 * click, Escape) replaces the URL without the `task` param; the server page
 * then renders with the drawer simply absent.
 */
export function TaskDetailPanel({
  task,
  comments,
  attachments,
  activity,
  currentUserId,
  members,
  projectLabels,
  isWatching,
  canEdit,
  canManage,
}: TaskDetailPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = React.useTransition()

  const [editingDescription, setEditingDescription] = React.useState(false)
  const [descriptionDraft, setDescriptionDraft] = React.useState(
    task.description ?? "",
  )
  const [savingDescription, setSavingDescription] = React.useState(false)

  const [subtaskTitle, setSubtaskTitle] = React.useState("")
  const [addingSubtask, setAddingSubtask] = React.useState(false)

  const [deleting, setDeleting] = React.useState(false)

  function navigateToTask(taskId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("task", taskId)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function close() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("task")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function onOpenChange(open: boolean) {
    if (!open) close()
  }

  function onStatusChange(status: TaskStatus) {
    startTransition(async () => {
      const res = await updateTaskStatus(task.id, status)
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  function onPriorityChange(priority: TaskPriority) {
    startTransition(async () => {
      const res = await updateTask({ taskId: task.id, priority })
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  function onTitleChange(title: string) {
    startTransition(async () => {
      const res = await updateTask({ taskId: task.id, title })
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  function onTypeChange(type: TaskType) {
    startTransition(async () => {
      const res = await updateTask({ taskId: task.id, type })
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  function onAssigneeChange(assigneeId: string | null) {
    startTransition(async () => {
      const res = await updateTask({ taskId: task.id, assigneeId })
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  function onDueDateChange(date: string | null) {
    startTransition(async () => {
      const res = await updateTask({
        taskId: task.id,
        // A yyyy-mm-dd from <input type=date> is parsed at local midnight.
        dueDate: date ? new Date(`${date}T00:00:00`) : null,
      })
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  function onLabelsChange(labelIds: string[]) {
    startTransition(async () => {
      const res = await updateTask({ taskId: task.id, labelIds })
      if (!res.ok) toast.error(res.error)
      router.refresh()
    })
  }

  async function saveDescription() {
    setSavingDescription(true)
    try {
      const res = await updateTask({
        taskId: task.id,
        description: descriptionDraft,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setEditingDescription(false)
      router.refresh()
    } finally {
      setSavingDescription(false)
    }
  }

  function cancelDescription() {
    setDescriptionDraft(task.description ?? "")
    setEditingDescription(false)
  }

  async function addSubtask() {
    const title = subtaskTitle.trim()
    if (!title || addingSubtask) return
    setAddingSubtask(true)
    try {
      const res = await createTask({
        projectId: task.projectId,
        title,
        parentId: task.id,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setSubtaskTitle("")
      router.refresh()
    } finally {
      setAddingSubtask(false)
    }
  }

  async function confirmDelete() {
    setDeleting(true)
    try {
      const res = await deleteTask(task.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      close()
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  const canDelete = canManage || task.reporterId === currentUserId

  const descriptionBlock = (
    <div className="space-y-6">
      <div className="space-y-2">
        {canEdit && !editingDescription ? (
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label="Edit description"
              onClick={() => setEditingDescription(true)}
            >
              <Pencil aria-hidden />
            </Button>
          </div>
        ) : null}

        {editingDescription ? (
          <div className="space-y-2">
            <RichTextEditor
              value={descriptionDraft}
              onChange={setDescriptionDraft}
              minHeight="120px"
              placeholder="Describe the task…"
              autofocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelDescription}
                disabled={savingDescription}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={saveDescription}
                disabled={savingDescription}
              >
                {savingDescription ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : task.description ? (
          <RichTextContent html={task.description} className="text-sm" />
        ) : null}
      </div>

      <div className="space-y-2.5">
        <h4 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          Subtasks{task.subtasks.length ? ` (${task.subtasks.length})` : ""}
        </h4>
        {task.subtasks.length > 0 ? (
          <ul className="space-y-1">
            {task.subtasks.map((subtask) => (
              <li key={subtask.id}>
                <button
                  type="button"
                  onClick={() => navigateToTask(subtask.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-raised motion-reduce:transition-none"
                >
                  <TypeIcon type={subtask.type} className="size-3.5 shrink-0" />
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {subtask.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {subtask.title}
                  </span>
                  <StatusBadge status={subtask.status} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Input
              value={subtaskTitle}
              onChange={(event) => setSubtaskTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void addSubtask()
                }
              }}
              placeholder="Add a subtask…"
              disabled={addingSubtask}
              className="h-7 text-sm"
            />
            <Button
              size="icon-sm"
              variant="outline"
              onClick={addSubtask}
              disabled={addingSubtask || !subtaskTitle.trim()}
              aria-label="Add subtask"
            >
              {addingSubtask ? (
                <Loader2
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <Plus aria-hidden />
              )}
            </Button>
          </div>
        ) : null}
      </div>

      {canDelete ? (
        <div className="pt-2">
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" size="sm" />}
            >
              <Trash2 aria-hidden />
              Delete task
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {task.key}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the task, its comments, and
                  attachments. Subtasks are kept and un-parented.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={confirmDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  )

  return (
    <TaskDrawer
      open
      onOpenChange={onOpenChange}
      task={task}
      description={descriptionBlock}
      comments={
        <CommentSection
          taskId={task.id}
          comments={comments}
          currentUserId={currentUserId}
          canComment={canEdit}
          canManage={canManage}
          // Mentionable = project members other than yourself (self-mentions
          // are a no-op server-side).
          mentionItems={members
            .filter((m) => m.id !== currentUserId)
            .map((m) => ({ id: m.username, name: m.name }))}
        />
      }
      attachments={
        <AttachmentSection
          taskId={task.id}
          attachments={attachments}
          currentUserId={currentUserId}
          canUpload={canEdit}
          canManage={canManage}
        />
      }
      activity={
        activity.length > 0 ? <ActivityList entries={activity} /> : undefined
      }
      headerAction={<WatchToggle taskId={task.id} watching={isWatching} />}
      members={members}
      projectLabels={projectLabels}
      onStatusChange={canEdit ? onStatusChange : undefined}
      onPriorityChange={canEdit ? onPriorityChange : undefined}
      onTitleChange={canEdit ? onTitleChange : undefined}
      onTypeChange={canEdit ? onTypeChange : undefined}
      onAssigneeChange={canEdit ? onAssigneeChange : undefined}
      onDueDateChange={canEdit ? onDueDateChange : undefined}
      onLabelsChange={canEdit ? onLabelsChange : undefined}
    />
  )
}
