import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { auth } from "@/lib/auth"
import { AuthorizationError, PROJECT_ROLE_ORDER } from "@/lib/permissions"
import type { ProjectRole } from "@/generated/prisma/enums"
import { TaskPriority, TaskStatus, TaskType } from "@/generated/prisma/enums"

import { getAttachments } from "@/features/attachments/queries"
import type { AttachmentWithUploader } from "@/features/attachments/types"
import { getComments } from "@/features/comments/queries"
import type { CommentWithAuthor } from "@/features/comments/types"
import { getProject } from "@/features/projects/queries"
import {
  getProjectMembers,
  listAssignableUsersForProject,
} from "@/features/admin/queries"
import { getTaskActivity } from "@/features/tasks/activity"
import { getTaskWatchers, isWatchingTask } from "@/features/notifications/queries"
import type { TaskWatcherItem } from "@/features/notifications/queries"
import { getTaskTime, getRunningTimer, getProjectTimeReport } from "@/features/time/queries"
import type { RunningTimer, TaskTime } from "@/features/time/queries"
import { ProjectTimeReport } from "@/features/time/components/ProjectTimeReport"
import type { ActivityEntry } from "@/features/tasks/activity"
import {
  AssigneeAvatar,
  BacklogView,
  BoardView,
  CreateTaskDialog,
  LabelManager,
  TaskDetailPanel,
  TaskFilters,
} from "@/features/tasks/components"
import type { BacklogFilters, BacklogSortField, TaskDetail } from "@/features/tasks/queries"
import {
  BACKLOG_SORT_FIELDS,
  getBacklogTasks,
  getBoardTasks,
  getProjectLabels,
  getTask,
} from "@/features/tasks/queries"
import { getSavedViews } from "@/features/saved-views/queries"

import { ManageMembersDialog } from "./ManageMembersDialog"
import { ProjectSettingsMenu } from "./ProjectSettingsMenu"
import { ViewTabs } from "./ViewTabs"

interface ProjectPageProps {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (Object.values(TaskStatus) as string[]).includes(value)
  )
}
function isTaskType(value: unknown): value is TaskType {
  return (
    typeof value === "string" &&
    (Object.values(TaskType) as string[]).includes(value)
  )
}
function isTaskPriority(value: unknown): value is TaskPriority {
  return (
    typeof value === "string" &&
    (Object.values(TaskPriority) as string[]).includes(value)
  )
}
function asString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}
function isSortField(value: unknown): value is BacklogSortField {
  return (
    typeof value === "string" &&
    (BACKLOG_SORT_FIELDS as readonly string[]).includes(value)
  )
}
function isSortDir(value: unknown): value is "asc" | "desc" {
  return value === "asc" || value === "desc"
}

export default async function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  const { projectId } = await params
  const sp = await searchParams

  const session = await auth()
  if (!session?.user) redirect("/login")

  // getProject THROWS on no access rather than returning null (see
  // features/projects/queries.ts) — caught here and folded into the same
  // not-found UI as a genuinely missing id, so an unauthorised user can't
  // distinguish "doesn't exist" from "exists but you can't see it".
  let project
  try {
    project = await getProject(projectId)
  } catch (err) {
    if (err instanceof AuthorizationError) {
      if (err.code === "UNAUTHENTICATED") redirect("/login")
      notFound()
    }
    throw err
  }
  if (!project) notFound()

  const isAdmin = session.user.globalRole === "ADMIN"
  const membership = project.memberships.find(
    (m) => m.userId === session.user.id,
  )
  const myRole: ProjectRole = isAdmin
    ? "MANAGER"
    : (membership?.projectRole ?? "VIEWER")
  const canEdit = PROJECT_ROLE_ORDER[myRole] >= PROJECT_ROLE_ORDER.MEMBER
  const canManage = PROJECT_ROLE_ORDER[myRole] >= PROJECT_ROLE_ORDER.MANAGER

  const members = project.memberships.map((m) => m.user)

  // MANAGERs (and admins) can manage members from the project page — fetch the
  // detailed member list + assignable users only when that UI will render.
  const memberAdmin = canManage
    ? await Promise.all([
        getProjectMembers(projectId),
        listAssignableUsersForProject(projectId),
      ])
    : null

  const view: "board" | "backlog" | "time" =
    sp.view === "backlog" ? "backlog" : sp.view === "time" ? "time" : "board"
  const taskId = asString(sp.task) ?? null

  const labels = await getProjectLabels(projectId)

  // Carries every current search param forward into pagination/tab links —
  // array-aware so repeated params (e.g. multiple assigneeId) aren't dropped.
  const currentParams = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) for (const v of value) currentParams.append(key, v)
    else if (value) currentParams.set(key, value)
  }

  // Assignee filter is a repeatable param; each value is a user id, "me"
  // (resolved to the signed-in user so saved views stay portable), or "none"
  // (unassigned).
  const rawAssignee = sp.assigneeId
  const assigneeValues = Array.isArray(rawAssignee)
    ? rawAssignee
    : rawAssignee
      ? [rawAssignee]
      : []
  const includeUnassigned = assigneeValues.includes("none")
  const assigneeIds = [
    ...new Set(
      assigneeValues
        .filter((v) => v !== "none")
        .map((v) => (v === "me" ? session.user.id : v)),
    ),
  ]

  // The filter subset both views share (board narrows its columns; backlog
  // adds sort + pagination on top).
  const filterSet = {
    status: isTaskStatus(sp.status) ? sp.status : undefined,
    type: isTaskType(sp.type) ? sp.type : undefined,
    priority: isTaskPriority(sp.priority) ? sp.priority : undefined,
    assigneeIds,
    includeUnassigned,
    labelId: asString(sp.labelId),
    q: asString(sp.q),
  }

  let viewContent: React.ReactNode
  if (view === "time") {
    const report = await getProjectTimeReport(projectId)
    viewContent = <ProjectTimeReport report={report} />
  } else if (view === "board") {
    const [boardTasks, savedViews] = await Promise.all([
      getBoardTasks(projectId, filterSet),
      getSavedViews(projectId),
    ])
    viewContent = (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <TaskFilters
          members={members}
          labels={labels}
          projectId={projectId}
          savedViews={savedViews}
        />
        <div className="min-h-0 flex-1">
          <BoardView tasks={boardTasks} disabled={!canEdit} />
        </div>
      </div>
    )
  } else {
    const filters: BacklogFilters = {
      ...filterSet,
      sort: isSortField(sp.sort) ? sp.sort : undefined,
      dir: isSortDir(sp.dir) ? sp.dir : undefined,
      cursor: asString(sp.cursor),
    }
    const [page, savedViews] = await Promise.all([
      getBacklogTasks(projectId, filters),
      getSavedViews(projectId),
    ])

    const startParams = new URLSearchParams(currentParams)
    startParams.delete("cursor")
    const nextParams = new URLSearchParams(currentParams)
    if (page.nextCursor) nextParams.set("cursor", page.nextCursor)

    viewContent = (
      <div className="flex flex-col gap-4">
        <TaskFilters
          members={members}
          labels={labels}
          projectId={projectId}
          savedViews={savedViews}
        />

        <BacklogView tasks={page.tasks} canEdit={canEdit} />

        {page.nextCursor || filters.cursor ? (
          <div className="flex items-center justify-between pt-2">
            <div>
              {filters.cursor ? (
                <Button
                  variant="ghost"
                  size="sm"
                  render={
                    <Link
                      href={`?${startParams.toString()}`}
                      scroll={false}
                    />
                  }
                >
                  <ArrowLeft />
                  Start
                </Button>
              ) : (
                <span />
              )}
            </div>
            <div>
              {page.nextCursor ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={
                    <Link
                      href={`?${nextParams.toString()}`}
                      scroll={false}
                    />
                  }
                >
                  Load more
                  <ArrowRight />
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  // The task drawer is a peer overlay, not the view content itself — its own
  // failures (stale/foreign task id) must not take down the board/backlog.
  // Data fetching stays inside the try/catch; JSX is only constructed after
  // it, once we know we have a complete, in-project result (React doesn't
  // render JSX synchronously, so a thrown render error wouldn't be caught by
  // a try/catch wrapped around the JSX itself).
  let drawerData: {
    task: TaskDetail
    comments: CommentWithAuthor[]
    attachments: AttachmentWithUploader[]
    activity: ActivityEntry[]
    isWatching: boolean
    watchers: TaskWatcherItem[]
    taskTime: TaskTime
    runningTimer: RunningTimer | null
  } | null = null

  if (taskId) {
    try {
      const task = await getTask(taskId)
      if (task && task.projectId === projectId) {
        const [comments, attachments, activity, isWatching, watchers, taskTime, runningTimer] =
          await Promise.all([
            getComments(taskId),
            getAttachments(taskId),
            getTaskActivity(taskId),
            isWatchingTask(taskId),
            getTaskWatchers(taskId),
            getTaskTime(taskId),
            getRunningTimer(),
          ])
        drawerData = {
          task,
          comments,
          attachments,
          activity,
          isWatching,
          watchers,
          taskTime,
          runningTimer,
        }
      }
    } catch (err) {
      if (!(err instanceof AuthorizationError)) throw err
      // Inaccessible / foreign task id — silently skip opening the drawer.
    }
  }

  const drawer = drawerData ? (
    <TaskDetailPanel
      key={drawerData.task.id}
      task={drawerData.task}
      comments={drawerData.comments}
      attachments={drawerData.attachments}
      activity={drawerData.activity}
      currentUserId={session.user.id}
      members={members}
      projectLabels={labels}
      isWatching={drawerData.isWatching}
      watchers={drawerData.watchers}
      taskTime={drawerData.taskTime}
      runningTimer={drawerData.runningTimer}
      canEdit={canEdit}
      canManage={canManage}
    />
  ) : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {project.key}
            </span>
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
              {project.name}
            </h1>
          </div>
          {project.description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {project.description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="flex -space-x-2">
            {members.slice(0, 5).map((member) => (
              <AssigneeAvatar
                key={member.id}
                user={member}
                className="rounded-full ring-2 ring-background"
              />
            ))}
            {members.length > 5 ? (
              <span className="flex size-6 items-center justify-center rounded-full border border-border bg-surface-raised text-[10px] text-muted-foreground ring-2 ring-background">
                +{members.length - 5}
              </span>
            ) : null}
          </div>
          {canEdit ? (
            <LabelManager
              projectId={projectId}
              labels={labels}
              canEdit={canEdit}
              canManage={canManage}
            />
          ) : null}
          {canManage && memberAdmin && memberAdmin[0] ? (
            <ManageMembersDialog
              projectId={projectId}
              projectName={project.name}
              members={memberAdmin[0].members}
              users={memberAdmin[1]}
            />
          ) : null}
          <ProjectSettingsMenu
            project={{
              id: project.id,
              key: project.key,
              name: project.name,
              description: project.description,
            }}
            canManage={canManage}
            isAdmin={isAdmin}
          />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs projectId={projectId} view={view} />
        {canEdit ? (
          <CreateTaskDialog
            projectId={projectId}
            members={members}
            labels={labels}
          />
        ) : null}
      </div>

      <div className="min-h-0 flex-1">{viewContent}</div>

      {drawer}
    </div>
  )
}
