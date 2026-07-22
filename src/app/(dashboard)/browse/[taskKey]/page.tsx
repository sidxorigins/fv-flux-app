import { notFound, redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { AuthorizationError, PROJECT_ROLE_ORDER } from "@/lib/permissions"
import type { ProjectRole } from "@/generated/prisma/enums"

import { getAttachments } from "@/features/attachments/queries"
import { getComments } from "@/features/comments/queries"
import { getTaskActivity } from "@/features/tasks/activity"
import { getTaskWatchers, isWatchingTask } from "@/features/notifications/queries"
import { getTaskTime, getRunningTimer } from "@/features/time/queries"
import { getProject } from "@/features/projects/queries"
import { getProjectLabels, getTask, resolveTaskIdByKey } from "@/features/tasks/queries"
import { isCuid, taskPagePath } from "@/features/tasks/share"
import { TaskPageView } from "@/features/tasks/components"

interface BrowsePageProps {
  params: Promise<{ taskKey: string }>
}

export default async function BrowseTaskPage({ params }: BrowsePageProps) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { taskKey } = await params

  // Legacy cuid link → redirect to the pretty key URL.
  if (isCuid(taskKey)) {
    const row = await prisma.task.findUnique({
      where: { id: taskKey },
      select: { key: true },
    })
    if (row) redirect(taskPagePath(row.key))
    notFound()
  }

  const taskId = await resolveTaskIdByKey(taskKey)
  if (!taskId) notFound()

  let task
  try {
    task = await getTask(taskId)
  } catch (err) {
    if (err instanceof AuthorizationError) {
      if (err.code === "UNAUTHENTICATED") redirect("/login")
      notFound()
    }
    throw err
  }
  if (!task) notFound()

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

  // Permission resolution mirrors the project page.
  let project
  try {
    project = await getProject(task.projectId)
  } catch {
    notFound()
  }
  if (!project) notFound()

  const isAdmin = session.user.globalRole === "ADMIN"
  const membership = project.memberships.find((m) => m.userId === session.user.id)
  const myRole: ProjectRole = isAdmin
    ? "MANAGER"
    : (membership?.projectRole ?? "VIEWER")
  const canEdit = PROJECT_ROLE_ORDER[myRole] >= PROJECT_ROLE_ORDER.MEMBER
  const canManage = PROJECT_ROLE_ORDER[myRole] >= PROJECT_ROLE_ORDER.MANAGER
  const members = project.memberships.map((m) => m.user)
  const projectLabels = await getProjectLabels(task.projectId)

  return (
    <TaskPageView
      task={task}
      projectKey={project.key}
      projectName={project.name}
      comments={comments}
      attachments={attachments}
      activity={activity}
      isWatching={isWatching}
      watchers={watchers}
      taskTime={taskTime}
      runningTimer={runningTimer}
      members={members}
      projectLabels={projectLabels}
      currentUserId={session.user.id}
      canEdit={canEdit}
      canManage={canManage}
    />
  )
}
