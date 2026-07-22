"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  CalendarDays,
  Check,
  ChevronDown,
  CornerLeftUp,
  Loader2,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from "lucide-react"
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
import type {
  Label as ProjectLabel,
  TaskPriority,
  TaskStatus,
  TaskType,
  User,
} from "@/generated/prisma/client"
import { cn } from "@/lib/utils"

import { AttachmentSection } from "@/features/attachments/components/AttachmentSection"
import type { AttachmentWithUploader } from "@/features/attachments/types"
import { CommentSection } from "@/features/comments/components/CommentSection"
import type { CommentWithAuthor } from "@/features/comments/types"
import { WatchersSection } from "@/features/notifications/components/WatchersSection"
import { WatchToggle } from "@/features/notifications/components/WatchToggle"
import type { TaskWatcherItem } from "@/features/notifications/queries"
import { TaskTimeSection } from "@/features/time/components/TaskTimeSection"
import type { RunningTimer, TaskTime } from "@/features/time/queries"

import type { ActivityEntry } from "../activity"
import { createTask, deleteTask, updateTask, updateTaskStatus } from "../actions"
import { formatDueDate } from "../format"
import type { TaskDetail } from "../queries"
import { projectPath, taskPagePath } from "../share"
import { ActivityList } from "./ActivityList"
import { AssigneeAvatar } from "./AssigneeAvatar"
import { CopyTaskLink } from "./CopyTaskLink"
import { useClientNow } from "./hooks"
import { LabelChip } from "./LabelChip"
import { PriorityBadge, PRIORITY_META, PRIORITY_ORDER } from "./PriorityBadge"
import { StatusBadge, STATUS_META, STATUS_ORDER } from "./StatusBadge"
import { TypeIcon, TYPE_META } from "./TypeIcon"

type Member = Pick<User, "id" | "name" | "username" | "avatarKey">

const TYPE_ORDER = ["TASK", "BUG", "STORY"] as const satisfies readonly TaskType[]

export interface TaskPageViewProps {
  task: TaskDetail
  projectKey: string
  projectName: string
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
  /** Users currently watching this task (drives the Watchers panel). */
  watchers: TaskWatcherItem[]
  /** Time totals + entries for this task (drives the Time panel). */
  taskTime: TaskTime
  /** The signed-in user's running timer, if any (drives the timer button). */
  runningTimer: RunningTimer | null
  /** MEMBER+ on this project — edit description/status/priority, add subtasks. */
  canEdit: boolean
  /** MANAGER+ (or global Admin) — manage others' comments/attachments, delete any task. */
  canManage: boolean
}

/** Chip-shaped dropdown trigger shared by the meta editors — mirrors TaskDrawer's. */
function chipTriggerClass() {
  return cn(
    "inline-flex items-center gap-1 rounded-md outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring/50"
  )
}

/** Format a Date as the yyyy-mm-dd a native <input type="date"> expects. */
function toDateInputValue(date: Date | null): string {
  if (!date) return ""
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/**
 * Inline-editable page title — click to edit (when `onSave` is provided);
 * Enter or blur commits a changed, non-empty title, Escape cancels. Same
 * pattern as TaskDrawer's EditableTitle, adapted to a static h1.
 */
function PageEditableTitle({
  title,
  onSave,
}: {
  title: string
  onSave?: (next: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(title)

  // Resync when the title prop changes underneath us (after our own save, or
  // an external rename) — render-phase adjustment, no effect-driven cascade.
  const [syncedTitle, setSyncedTitle] = React.useState(title)
  if (syncedTitle !== title) {
    setSyncedTitle(title)
    setDraft(title)
    setEditing(false)
  }

  function commit() {
    const next = draft.trim()
    if (next && next !== title) onSave?.(next)
    else setDraft(title)
    setEditing(false)
  }

  if (!onSave) {
    return (
      <h1 className="text-2xl leading-snug font-semibold text-foreground">
        {title}
      </h1>
    )
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            setDraft(title)
            setEditing(false)
          }
        }}
        aria-label="Task title"
        className="h-auto py-1 text-2xl leading-snug font-semibold"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="-mx-1 w-full rounded-md px-1 py-0.5 text-left text-2xl leading-snug font-semibold text-foreground outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring/50"
      title="Click to edit title"
    >
      {title}
    </button>
  )
}

/**
 * Inline-editable estimated-hours figure — same click-to-edit / blur-or-Enter-commit
 * / Escape-cancel pattern as TaskDrawer's EditableEstimatedHours.
 */
function EstimateControl({
  hours,
  onSave,
}: {
  hours: number | null
  onSave?: (next: number | null) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(hours === null ? "" : String(hours))

  const [syncedHours, setSyncedHours] = React.useState(hours)
  if (syncedHours !== hours) {
    setSyncedHours(hours)
    setDraft(hours === null ? "" : String(hours))
    setEditing(false)
  }

  function commit() {
    const trimmed = draft.trim()
    const next = trimmed === "" ? null : Number(trimmed)
    if (next !== null && (Number.isNaN(next) || next < 0)) {
      setDraft(hours === null ? "" : String(hours))
      setEditing(false)
      return
    }
    if (next !== hours) onSave?.(next)
    setEditing(false)
  }

  if (!onSave) {
    return (
      <span className="text-sm tabular-nums text-foreground">
        {hours === null ? "—" : `${hours}h`}
      </span>
    )
  }

  if (editing) {
    return (
      <Input
        type="number"
        min={0}
        step={0.5}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            setDraft(hours === null ? "" : String(hours))
            setEditing(false)
          }
        }}
        aria-label="Estimated hours"
        className="h-7 w-20 px-1.5 text-sm tabular-nums"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-sm tabular-nums text-foreground hover:text-primary"
      aria-label="Change estimated hours"
    >
      {hours === null ? "Set estimate" : `${hours}h`}
    </button>
  )
}

/** Sidebar panel shell — solid surface (not glass; this isn't chrome, see CLAUDE.md). */
function SidebarSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A single "label : control" row inside the Details meta panel. */
function MetaRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}

/**
 * Full-page task view at `/browse/<key>`. Client half of the key-URL route —
 * the server page fetches task + comments + attachments + activity and
 * renders this with the data already in hand (no client fetching). Mutations
 * call the same Server Actions the drawer uses and `router.refresh()`;
 * navigation between tasks (parent/subtask) goes through `taskPagePath`
 * rather than the drawer's `?task=` param.
 */
export function TaskPageView(props: TaskPageViewProps) {
  const {
    task,
    projectKey,
    projectName,
    comments,
    attachments,
    activity,
    currentUserId,
    members,
    projectLabels,
    isWatching,
    watchers,
    taskTime,
    runningTimer,
    canEdit,
    canManage,
  } = props

  const router = useRouter()
  const [, startTransition] = React.useTransition()
  const now = useClientNow()

  const [editingDescription, setEditingDescription] = React.useState(false)
  const [descriptionDraft, setDescriptionDraft] = React.useState(
    task.description ?? ""
  )
  const [savingDescription, setSavingDescription] = React.useState(false)

  const [subtaskTitle, setSubtaskTitle] = React.useState("")
  const [addingSubtask, setAddingSubtask] = React.useState(false)

  const [deleting, setDeleting] = React.useState(false)

  function navigateToTask(taskKey: string) {
    router.push(taskPagePath(taskKey))
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

  function onEstimatedHoursChange(estimatedHours: number | null) {
    startTransition(async () => {
      const res = await updateTask({ taskId: task.id, estimatedHours })
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
      router.push(projectPath(projectKey))
    } finally {
      setDeleting(false)
    }
  }

  const canDelete = canManage || task.reporterId === currentUserId
  const selectedLabelIds = new Set(task.labels.map((l) => l.id))

  const dueDate = task.dueDate ? new Date(task.dueDate) : null
  const isOverdue =
    dueDate !== null &&
    now !== null &&
    task.status !== "DONE" &&
    dueDate.getTime() < now.getTime()

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href={projectPath(projectKey)} className="hover:text-foreground">
          {projectName}
        </Link>
        <span aria-hidden>/</span>
        <span className="font-mono text-foreground">{task.key}</span>
      </nav>

      {/* Parent backlink (subtask → parent) */}
      {task.parent ? (
        <button
          type="button"
          onClick={() => navigateToTask(task.parent!.key)}
          className="mb-3 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-surface-raised motion-reduce:transition-none"
        >
          <CornerLeftUp
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="shrink-0 text-xs text-muted-foreground">Parent</span>
          <TypeIcon type={task.parent.type} className="size-3.5 shrink-0" />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {task.parent.key}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {task.parent.title}
          </span>
        </button>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <main className="min-w-0 space-y-6">
          {/* Type + key + header actions */}
          <div className="flex items-center gap-2">
            {canEdit ? (
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
            <div className="ml-auto flex items-center gap-1">
              <CopyTaskLink taskKey={task.key} />
              <WatchToggle taskId={task.id} watching={isWatching} />
            </div>
          </div>

          <PageEditableTitle
            title={task.title}
            onSave={canEdit ? onTitleChange : undefined}
          />

          {/* Description */}
          <section className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Description
              </h2>
              <div className="h-px flex-1 bg-border" aria-hidden />
              {canEdit && !editingDescription ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label="Edit description"
                  onClick={() => setEditingDescription(true)}
                >
                  <Pencil aria-hidden />
                </Button>
              ) : null}
            </div>

            {editingDescription ? (
              <div className="space-y-2">
                <RichTextEditor
                  value={descriptionDraft}
                  onChange={setDescriptionDraft}
                  minHeight="160px"
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
            ) : (
              <p className="text-sm text-muted-foreground">No description yet.</p>
            )}
          </section>

          {/* Subtasks */}
          <section className="space-y-2.5">
            <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Subtasks{task.subtasks.length ? ` (${task.subtasks.length})` : ""}
            </h2>
            {task.subtasks.length > 0 ? (
              <ul className="space-y-1">
                {task.subtasks.map((subtask) => (
                  <li key={subtask.id}>
                    <button
                      type="button"
                      onClick={() => navigateToTask(subtask.key)}
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
                  className="h-8 text-sm"
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
          </section>

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

          <SidebarSection title="Comments">
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
          </SidebarSection>
        </main>

        <aside className="space-y-4">
          <SidebarSection title="Details">
            <div className="space-y-3">
              <MetaRow label="Status">
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
              </MetaRow>

              <MetaRow label="Priority">
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
                              <Check className="ml-auto size-3.5" aria-hidden />
                            ) : null}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <PriorityBadge priority={task.priority} />
                )}
              </MetaRow>

              <MetaRow label="Assignee">
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(chipTriggerClass(), "gap-1.5")}
                      aria-label="Change assignee"
                    >
                      <AssigneeAvatar user={task.assignee} />
                      <span className="max-w-28 truncate text-sm text-foreground">
                        {task.assignee?.name ?? (
                          <span className="text-muted-foreground">
                            Unassigned
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-72 w-52 overflow-y-auto">
                      <DropdownMenuItem onClick={() => onAssigneeChange(null)}>
                        <span className="text-muted-foreground">Unassigned</span>
                        {!task.assignee ? (
                          <Check className="ml-auto size-3.5" aria-hidden />
                        ) : null}
                      </DropdownMenuItem>
                      {members.map((member) => (
                        <DropdownMenuItem
                          key={member.id}
                          onClick={() => onAssigneeChange(member.id)}
                        >
                          <AssigneeAvatar user={member} />
                          <span className="truncate">{member.name}</span>
                          {task.assignee?.id === member.id ? (
                            <Check className="ml-auto size-3.5" aria-hidden />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <AssigneeAvatar user={task.assignee} />
                    <span className="max-w-28 truncate text-sm text-foreground">
                      {task.assignee?.name ?? (
                        <span className="text-muted-foreground">
                          Unassigned
                        </span>
                      )}
                    </span>
                  </span>
                )}
              </MetaRow>

              <MetaRow label="Due date">
                {canEdit ? (
                  <Popover>
                    <PopoverTrigger
                      className={cn(
                        chipTriggerClass(),
                        "gap-1 text-sm tabular-nums",
                        isOverdue ? "text-danger" : "text-foreground"
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
                      isOverdue ? "text-danger" : "text-foreground"
                    )}
                    aria-label={`Due ${formatDueDate(dueDate)}${isOverdue ? ", overdue" : ""}`}
                  >
                    <CalendarDays className="size-3.5" aria-hidden />
                    {formatDueDate(dueDate)}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </MetaRow>

              <MetaRow label="Estimate">
                <EstimateControl
                  hours={task.estimatedHours}
                  onSave={canEdit ? onEstimatedHoursChange : undefined}
                />
              </MetaRow>

              <div className="space-y-1.5 border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">Labels</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {task.labels.map((label) => (
                    <LabelChip key={label.id} label={label} />
                  ))}
                  {canEdit ? (
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
                        {projectLabels.length > 0 ? (
                          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                            {projectLabels.map((label) => (
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
                  ) : null}
                </div>
              </div>
            </div>
          </SidebarSection>

          <SidebarSection title="Time">
            <TaskTimeSection
              taskId={task.id}
              time={taskTime}
              running={runningTimer}
              canLog={canEdit}
              currentUserId={currentUserId}
            />
          </SidebarSection>

          <SidebarSection title="Attachments">
            <AttachmentSection
              taskId={task.id}
              attachments={attachments}
              currentUserId={currentUserId}
              canUpload={canEdit}
              canManage={canManage}
            />
          </SidebarSection>

          <SidebarSection title="Watchers">
            <WatchersSection
              taskId={task.id}
              watchers={watchers}
              members={members}
              canManage={canEdit}
              currentUserId={currentUserId}
            />
          </SidebarSection>

          {activity.length > 0 ? (
            <SidebarSection title="Activity">
              <ActivityList entries={activity} />
            </SidebarSection>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
