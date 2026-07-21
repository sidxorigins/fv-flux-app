import { getTeamProductivity, getVisibleTeams } from "@/features/team/queries";
import type { TeamProductivity } from "@/features/team/queries";
import { TeamProductivitySection } from "@/features/team/components/TeamProductivitySection";
import { DashboardEntrance } from "@/features/dashboard/components/DashboardEntrance";

function EmptyState() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">
        Team
      </h1>
      <div className="glass mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-2 px-8 py-12 text-center">
        <p className="text-foreground text-base font-medium">
          No team has shared productivity with you yet
        </p>
        <p className="text-muted-foreground text-sm">
          Ask your team&apos;s manager to turn on &quot;Members can see each
          other&apos;s productivity&quot; to see teammate stats here.
        </p>
      </div>
    </div>
  );
}

/**
 * `/team` — the Team Productivity Visibility (#8) view. Guarded entirely by
 * the queries it calls: `getVisibleTeams()` resolves which teams the signed-in
 * user is even allowed to open (Admin, the team's manager, or a member of a
 * team with `membersCanSeeProductivity` on), and `getTeamProductivity(teamId)`
 * re-checks that same gate from the DB before returning any per-teammate
 * data. A user with no visible team never sees another user's numbers — just
 * the friendly empty state — and the nav link itself is hidden for them too
 * (see `Sidebar`/`Topbar`'s `showTeam`).
 *
 * Mirrors `/manager`'s RSC compose pattern: resolve scope, fetch everything
 * needed in parallel, wrap the whole page in the one after-paint
 * `DashboardEntrance` fade — numbers render immediately either way.
 *
 * Per-team fetches use `Promise.allSettled`, not `Promise.all`: a team's
 * `membersCanSeeProductivity` toggle (or the caller's own membership) can
 * flip between `getVisibleTeams()` resolving the picker and the per-team
 * `getTeamProductivity` call landing, which throws `AuthorizationError`. A
 * settled-but-rejected team is simply omitted rather than 500ing the whole
 * page — the user still sees every team that succeeded.
 */
export default async function TeamPage() {
  const teams = await getVisibleTeams();

  if (teams.length === 0) {
    return <EmptyState />;
  }

  const settled = await Promise.allSettled(
    teams.map((team) => getTeamProductivity(team.id)),
  );
  const productivity = settled
    .filter(
      (r): r is PromiseFulfilledResult<TeamProductivity> => r.status === "fulfilled",
    )
    .map((r) => r.value);

  return (
    <DashboardEntrance>
      <div className="flex flex-col gap-6">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Team
        </h1>

        {productivity.map((team) => (
          <TeamProductivitySection key={team.teamId} team={team} />
        ))}
      </div>
    </DashboardEntrance>
  );
}
