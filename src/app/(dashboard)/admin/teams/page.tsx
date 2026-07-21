import { getTeams } from "@/features/admin/queries";
import { CreateTeamDialog } from "@/features/admin/components/CreateTeamDialog";
import { TeamsTable } from "@/features/admin/components/TeamsTable";

export default async function AdminTeamsPage() {
  const teams = await getTeams();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Teams group users under a manager and grant them project access in
          bulk. The manager can add/remove team members without needing admin
          access.
        </p>
        <div className="shrink-0">
          <CreateTeamDialog />
        </div>
      </div>

      <TeamsTable teams={teams} />
    </div>
  );
}
