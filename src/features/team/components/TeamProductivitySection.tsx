import type { TeamProductivity } from "@/features/team/queries";
import { TeammateCard } from "./TeammateCard";

/**
 * One team's section on `/team`: a name heading + a responsive grid of
 * `TeammateCard`s. A user can see more than one team here (e.g. a manager of
 * two teams, or a global Admin), so each team gets its own heading rather
 * than flattening everyone into one grid.
 */
export function TeamProductivitySection({ team }: { team: TeamProductivity }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-foreground text-lg font-semibold tracking-tight">
        {team.teamName}
      </h2>

      {team.members.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No team members yet
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {team.members.map((member) => (
            <TeammateCard key={member.userId} member={member} />
          ))}
        </div>
      )}
    </section>
  );
}
