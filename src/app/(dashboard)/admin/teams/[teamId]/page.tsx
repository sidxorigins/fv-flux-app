import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { canManageTeam } from "@/lib/permissions";
import { getProjects, getTeam, listAssignableUsers } from "@/features/admin/queries";
import { TeamDetailEditor } from "@/features/admin/components/TeamDetailEditor";

interface TeamDetailPageProps {
  params: Promise<{ teamId: string }>;
}

/**
 * Team detail — viewable/manageable by a global Admin OR the team's own
 * MANAGER (delegation clause, see CLAUDE.md "Admin Dashboard" + the B4 brief).
 *
 * `AdminLayout` (the parent `(dashboard)/admin/layout.tsx`) already gates every
 * `/admin/*` route to a global Admin, so today a non-admin team manager can't
 * reach this route at all — the `canManageTeam` check below is the actual
 * authorisation for the delegation clause and is what unblocks it once that
 * layout-level gate is loosened for team managers (tracked as a follow-up, not
 * part of this UI-only task).
 */
export default async function AdminTeamDetailPage({ params }: TeamDetailPageProps) {
  const { teamId } = await params;

  const session = await auth();
  const userId = session?.user?.id;
  const globalRole = session?.user?.globalRole;
  if (!userId) redirect("/login");

  const allowed = await canManageTeam(userId, teamId);
  if (!allowed) notFound();

  const canManageAsAdmin = globalRole === "ADMIN";

  const [team, users, projects] = await Promise.all([
    getTeam(teamId),
    listAssignableUsers(),
    getProjects(),
  ]);
  if (!team) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          render={<Link href="/admin/teams" />}
        >
          <ArrowLeft />
          Back to teams
        </Button>
      </div>

      <TeamDetailEditor
        team={team}
        users={users}
        projects={projects}
        canManageAsAdmin={canManageAsAdmin}
      />
    </div>
  );
}
