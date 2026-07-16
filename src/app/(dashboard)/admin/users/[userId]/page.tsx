import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getProjects, getUser } from "@/features/admin/queries";
import { MembershipEditor } from "@/features/admin/components/MembershipEditor";
import {
  GlobalRoleBadge,
  UserStatusBadge,
  initials,
} from "@/features/admin/components/display";

interface UserDetailPageProps {
  params: Promise<{ userId: string }>;
}

export default async function AdminUserDetailPage({ params }: UserDetailPageProps) {
  const { userId } = await params;

  const [user, projects] = await Promise.all([getUser(userId), getProjects()]);
  if (!user) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          render={<Link href="/admin/users" />}
        >
          <ArrowLeft />
          Back to users
        </Button>
      </div>

      {/* Profile block */}
      <div className="glass flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Avatar size="lg">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{user.name}</h2>
              <GlobalRoleBadge role={user.globalRole} />
              <UserStatusBadge status={user.status} />
            </div>
            <p className="font-mono text-sm text-muted-foreground">@{user.username}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            {user.bio ? (
              <p className="mt-1 max-w-prose text-sm text-foreground/90">{user.bio}</p>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Joined {user.createdAtLabel}</p>
      </div>

      {/* Per-project access — the core "give role-based access" screen */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold text-foreground">Project access</h3>
          <p className="text-sm text-muted-foreground">
            Grant this user access to a project and set their role. Roles: Manager
            (manage the project &amp; members), Member (create/edit tasks), Viewer
            (read-only).
          </p>
        </div>
        <MembershipEditor
          userId={user.id}
          userName={user.name}
          memberships={user.memberships}
          projects={projects.map((p) => ({ id: p.id, key: p.key, name: p.name }))}
        />
      </div>
    </div>
  );
}
