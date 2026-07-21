import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Hourglass,
  ListTodo,
  PlayCircle,
  TrendingUp,
} from "lucide-react";

import { isManagerOfAnyTeam, requireUser } from "@/lib/permissions";
import {
  getManagerActiveTasksByMember,
  getManagerKpis,
  getManagerProjectProgress,
  getManagerScope,
  getManagerTeamActivity,
  getManagerTeams,
  getManagerWorkload,
  listAssignableUsersForManager,
  type ManagerAssignableUser,
  type ManagerTeam,
} from "@/features/manager/queries";
import { KpiCard } from "@/features/dashboard/components/KpiCard";
import { ActivityFeed } from "@/features/dashboard/components/ActivityFeed";
import { DashboardEntrance } from "@/features/dashboard/components/DashboardEntrance";
import { ManagerTeamMembers } from "@/features/manager/components/ManagerTeamMembers";
import { MemberActiveTasks } from "@/features/manager/components/MemberActiveTasks";
import { WorkloadBars } from "@/features/manager/components/WorkloadBars";
import { ProjectProgressList } from "@/features/manager/components/ProjectProgressList";

/** Small-caps muted section heading — mirrors the personal dashboard's Panel chrome. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
      {children}
    </h2>
  );
}

/** Glass panel — same chrome as the personal dashboard's widgets. */
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass flex flex-col gap-3 p-5">
      <SectionHeading>{title}</SectionHeading>
      {children}
    </section>
  );
}

function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">
        Manager
      </h1>
      <div className="glass mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-2 px-8 py-12 text-center">
        <p className="text-foreground text-base font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{body}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * "My teams" delegation section (Task C3) — own-team member add/remove.
 * Deliberately independent of project scope: a team can have members before
 * it's ever linked to a project, and `/admin/teams/*` is Admin-only at the
 * proxy layer, so this page is the ONLY UI path a non-admin team manager has
 * to manage their team's membership. Rendered both on the full dashboard and
 * on the "no projects yet" empty state below.
 */
function MyTeamsSection({
  teams,
  users,
}: {
  teams: ManagerTeam[];
  users: ManagerAssignableUser[];
}) {
  if (teams.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>My teams</SectionHeading>
      <ManagerTeamMembers teams={teams} users={users} />
    </section>
  );
}

/**
 * The manager dashboard — scoped to the teams the signed-in user manages (or
 * every active team, for a global Admin). Guarded server-side: reaching this
 * route without managing a team (or being Admin) never runs a single manager
 * query, it just renders the same friendly empty state the nav link itself
 * is hidden behind. Everything below fetches in one `Promise.all`, mirroring
 * `/dashboard`'s compose pattern — scope resolves once and is shared by every
 * aggregate, and the whole grid gets the one after-paint fade via
 * `DashboardEntrance`, nothing more.
 */
export default async function ManagerPage() {
  const me = await requireUser();
  const allowed = me.globalRole === "ADMIN" || (await isManagerOfAnyTeam(me.id));

  if (!allowed) {
    return (
      <EmptyState
        title="You don't manage any teams yet"
        body="Once you're set as a team's manager, this page will show your team's KPIs, workload, and active tasks."
      />
    );
  }

  const scope = await getManagerScope();

  if (scope.projectIds.length === 0) {
    const [teams, assignableUsers] = await Promise.all([
      getManagerTeams(),
      listAssignableUsersForManager(),
    ]);
    return (
      <EmptyState
        title="Your team doesn't have any projects yet"
        body="Once your team is linked to a project, KPIs, workload, and active tasks will appear here."
      >
        <MyTeamsSection teams={teams} users={assignableUsers} />
      </EmptyState>
    );
  }

  const [kpis, workload, activeTasks, projectProgress, activity, teams, assignableUsers] =
    await Promise.all([
      getManagerKpis(scope),
      getManagerWorkload(scope),
      getManagerActiveTasksByMember(scope),
      getManagerProjectProgress(scope),
      getManagerTeamActivity(scope),
      getManagerTeams(),
      listAssignableUsersForManager(),
    ]);

  const now = new Date();

  return (
    <DashboardEntrance>
      <div className="flex flex-col gap-6">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Manager
        </h1>

        {/* KPI row — real numbers from first paint, no count-up */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            label="Assigned"
            value={kpis.assigned}
            icon={ListTodo}
            caption="across your teams"
          />
          <KpiCard
            label="Done"
            value={kpis.done}
            icon={CheckCircle2}
            iconClass="text-success"
            caption="completed"
          />
          <KpiCard
            label="In progress"
            value={kpis.inProgress}
            icon={PlayCircle}
            iconClass="text-info"
            caption="being worked on"
          />
          <KpiCard
            label="Overdue"
            value={kpis.overdue}
            icon={CalendarClock}
            iconClass="text-danger"
            caption="past due, not done"
          />
          <KpiCard
            label="On-time"
            value={kpis.completedOnTime}
            icon={BadgeCheck}
            iconClass="text-success"
            caption="completed on time"
          />
          <KpiCard
            label="Late"
            value={kpis.completedLate}
            icon={AlertTriangle}
            iconClass="text-danger"
            caption="completed after due date"
          />
          <KpiCard
            label="Actual hrs"
            value={kpis.actualHours}
            icon={Clock3}
            iconClass="text-info"
            caption="logged"
          />
          <KpiCard
            label="Remaining hrs"
            value={kpis.remainingHours}
            icon={Hourglass}
            caption="estimate minus actual"
          />
          <KpiCard
            label="Over estimate"
            value={kpis.overEstimateCount}
            icon={TrendingUp}
            iconClass="text-danger"
            caption="tasks over their estimate"
          />
        </div>

        {/* Main bento: 2/3 the headline (active tasks) + workload, 1/3 progress + activity */}
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            <Panel title="Active tasks by member">
              <MemberActiveTasks members={activeTasks} now={now} />
            </Panel>

            <Panel title="Workload — active tasks by member">
              <WorkloadBars data={workload} />
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Project progress">
              <ProjectProgressList data={projectProgress} />
            </Panel>

            <Panel title="Team activity">
              <ActivityFeed items={activity} />
            </Panel>
          </div>
        </div>

        <MyTeamsSection teams={teams} users={assignableUsers} />
      </div>
    </DashboardEntrance>
  );
}
