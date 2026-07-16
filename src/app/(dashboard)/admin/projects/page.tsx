import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";

import { getProjects } from "@/features/admin/queries";

export default async function AdminProjectsPage() {
  const projects = await getProjects();

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        No projects yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Choose a project to manage who has access and their role.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={`/admin/projects/${p.id}`}
              className="group flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-sm bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-muted-foreground group-hover:bg-surface">
                  {p.key}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </div>
              <span className="font-medium text-foreground">{p.name}</span>
              {p.description ? (
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {p.description}
                </span>
              ) : null}
              <div className="mt-auto flex items-center gap-3 pt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="size-3.5" aria-hidden />
                  {p.memberCount} {p.memberCount === 1 ? "member" : "members"}
                </span>
                <span>Lead: {p.leadName}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
