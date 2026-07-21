import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getProjectLeads,
  getProjectMembers,
  listAssignableUsers,
} from "@/features/admin/queries";
import { ProjectLeadsEditor } from "@/features/admin/components/ProjectLeadsEditor";
import { ProjectMembersEditor } from "@/features/admin/components/ProjectMembersEditor";

interface ProjectDetailPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function AdminProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { projectId } = await params;

  const [data, users, leads] = await Promise.all([
    getProjectMembers(projectId),
    listAssignableUsers(),
    getProjectLeads(projectId),
  ]);
  if (!data) notFound();

  const { project, members } = data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          render={<Link href="/admin/projects" />}
        >
          <ArrowLeft />
          Back to projects
        </Button>
      </div>

      <div className="glass flex flex-col gap-1 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {project.key}
          </span>
          <h2 className="text-lg font-semibold text-foreground">{project.name}</h2>
        </div>
        {project.description ? (
          <p className="max-w-prose text-sm text-muted-foreground">{project.description}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">Lead: {project.leadName}</p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold text-foreground">Project leads</h3>
          <p className="text-sm text-muted-foreground">
            The primary lead is the project&rsquo;s required owner; co-leads share the
            same Manager-level access. Set another primary before removing the
            current one.
          </p>
        </div>
        <ProjectLeadsEditor
          projectId={project.id}
          projectName={project.name}
          leads={leads.leads}
          users={users}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold text-foreground">Members &amp; access</h3>
          <p className="text-sm text-muted-foreground">
            Add users to this project and set their role. Manager can manage the
            project &amp; members, Member can create/edit tasks, Viewer is read-only.
          </p>
        </div>
        <ProjectMembersEditor
          projectId={project.id}
          projectName={project.name}
          members={members}
          users={users}
        />
      </div>
    </div>
  );
}
