import Link from "next/link"
import { FolderKanban } from "lucide-react"

import { prisma } from "@/lib/db"
import { Badge } from "@/components/ui/badge"
import { getMyProjects } from "@/features/projects/queries"
import type { ProjectRole } from "@/generated/prisma/enums"

import { CreateProjectDialog } from "./CreateProjectDialog"

const ROLE_LABEL: Record<ProjectRole, string> = {
  MANAGER: "Manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
}

export default async function ProjectsPage() {
  const projects = await getMyProjects()

  // getMyProjects() doesn't hydrate the lead relation (that's ProjectDetail's
  // job, via getProject) — one small batched lookup for the card's "lead"
  // line rather than an N+1 or a new query export.
  const leadIds = [...new Set(projects.map((p) => p.leadId))]
  const leads = leadIds.length
    ? await prisma.user.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, name: true },
      })
    : []
  const leadNameById = new Map(leads.map((l) => [l.id, l.name]))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Projects
          </h1>
          <p className="text-sm text-muted-foreground">
            Projects you have access to.
          </p>
        </div>
        {/* Any active user can create a project (they become its manager). */}
        <CreateProjectDialog />
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <FolderKanban aria-hidden className="size-8 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">
            You don&apos;t have access to any projects yet — an admin will add
            you, or create one to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 outline-none transition-colors duration-150 hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-md bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {project.key}
                </span>
                <Badge variant="outline">{ROLE_LABEL[project.role]}</Badge>
              </div>

              <div className="space-y-1">
                <h2 className="font-medium text-foreground">{project.name}</h2>
                {project.description ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {project.description}
                  </p>
                ) : null}
              </div>

              <div className="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground">
                <span className="truncate">
                  Lead {leadNameById.get(project.leadId) ?? "—"}
                </span>
                <span className="shrink-0 tabular-nums">
                  {project.openTaskCount} open
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
