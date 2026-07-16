import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getProjectMembers, listAssignableUsers } from "@/features/admin/queries";
import { ProjectMembersEditor } from "@/features/admin/components/ProjectMembersEditor";

interface ProjectDetailPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function AdminProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { projectId } = await params;

  const [data, users] = await Promise.all([
    getProjectMembers(projectId),
    listAssignableUsers(),
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
