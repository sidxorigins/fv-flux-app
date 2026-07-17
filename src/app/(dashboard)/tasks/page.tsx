import { PartyPopper } from "lucide-react"

import { getCreatableProjects, getMyProjects } from "@/features/projects/queries"
import { getMyTasks } from "@/features/tasks/queries"
import { CreateTaskDialog } from "@/features/tasks/components"
import type { BoardTask } from "@/features/tasks/types"

import { MyTasksTable, type MyTasksGroup } from "./MyTasksTable"

export default async function MyTasksPage() {
  const [tasks, projects, creatable] = await Promise.all([
    getMyTasks(100),
    getMyProjects(),
    getCreatableProjects(),
  ])
  const projectById = new Map(projects.map((p) => [p.id, p]))

  const groupsById = new Map<string, MyTasksGroup>()
  for (const task of tasks as BoardTask[]) {
    const existing = groupsById.get(task.projectId)
    if (existing) {
      existing.tasks.push(task)
      continue
    }
    const project = projectById.get(task.projectId)
    groupsById.set(task.projectId, {
      project: project
        ? { id: project.id, key: project.key, name: project.name }
        : { id: task.projectId, key: "—", name: "Unknown project" },
      tasks: [task],
    })
  }
  const groups = [...groupsById.values()].sort((a, b) =>
    a.project.key.localeCompare(b.project.key),
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            My Tasks
          </h1>
          <p className="text-sm text-muted-foreground">
            Tasks assigned to you, across every project.
          </p>
        </div>
        {creatable.length > 0 ? (
          <CreateTaskDialog projects={creatable} />
        ) : null}
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <PartyPopper aria-hidden className="size-8 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">
            {creatable.length > 0
              ? "Nothing assigned to you yet — create a task to get started."
              : "Nothing assigned to you. Enjoy the calm."}
          </p>
        </div>
      ) : (
        <MyTasksTable groups={groups} />
      )}
    </div>
  )
}
