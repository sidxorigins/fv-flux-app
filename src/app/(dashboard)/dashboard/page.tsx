import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Eye,
  ListTodo,
} from "lucide-react";

import { getCreatableProjects } from "@/features/projects/queries";
import {
  getDashboardScope,
  getKpis,
  getMyWorkGrouped,
  getProjectTiles,
  getRecentActivity,
  getStatusDistribution,
  getThroughput,
  getWorkload,
} from "@/features/dashboard/queries";
import { getNotificationsPage } from "@/features/notifications/queries";
import { getMyLoggedHours } from "@/features/time/queries";
import { MyLoggedHours } from "@/features/time/components/MyLoggedHours";
import { KpiCard } from "@/features/dashboard/components/KpiCard";
import {
  StatusDonut,
  ThroughputArea,
  WorkloadBar,
} from "@/features/dashboard/components/Charts";
import { GroupedWorkList } from "@/features/dashboard/components/GroupedWorkList";
import { InboxPanel } from "@/features/dashboard/components/InboxPanel";
import { ActivityFeed } from "@/features/dashboard/components/ActivityFeed";
import { ProjectTiles } from "@/features/dashboard/components/ProjectTiles";
import { DashboardEntrance } from "@/features/dashboard/components/DashboardEntrance";
import { CreateTaskDialog } from "@/features/tasks/components";
import { cn } from "@/lib/utils";

/** Small-caps muted section heading — the one heading style across the grid. */
function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-muted-foreground text-xs font-medium tracking-wider uppercase",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** "You" (personal) vs "Team" (project-wide) chip — clarifies each widget's scope. */
function ScopeChip({ scope }: { scope: "you" | "team" }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
        scope === "you"
          ? "bg-primary/12 text-primary"
          : "bg-surface-raised text-muted-foreground",
      )}
    >
      {scope === "you" ? "You" : "Team"}
    </span>
  );
}

/** Glass panel — the dashboard-card chrome (charts, lists). */
function Panel({
  title,
  scope,
  action,
  children,
}: {
  title: string;
  scope?: "you" | "team";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass flex flex-col gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <SectionHeading>{title}</SectionHeading>
          {scope ? <ScopeChip scope={scope} /> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The flagship screen. Everything is fetched server-side in one Promise.all —
 * the scope (session user + member-project ids) resolves once and is shared by
 * every aggregate query. The only client JS on the page: the two chart panels,
 * the inline status dropdowns, and the one entrance wrapper.
 */
export default async function DashboardPage() {
  const scope = await getDashboardScope();

  // No memberships → the CLAUDE.md onboarding empty state, no dead widgets.
  if (scope.projectIds.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Dashboard
        </h1>
        <div className="glass mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-2 px-8 py-12 text-center">
          <p className="text-foreground text-base font-medium">
            You don&apos;t have access to any projects yet
          </p>
          <p className="text-muted-foreground text-sm">
            An admin will add you. Once you&apos;re in a project, your work,
            activity and charts appear here.
          </p>
        </div>
      </div>
    );
  }

  const [
    kpis,
    statusDist,
    throughput,
    workload,
    activity,
    tiles,
    work,
    inbox,
    creatable,
    loggedHours,
  ] = await Promise.all([
    getKpis(scope),
    getStatusDistribution(scope),
    getThroughput(scope),
    getWorkload(scope),
    getRecentActivity(12, scope),
    getProjectTiles(scope),
    getMyWorkGrouped(),
    getNotificationsPage({ unreadOnly: true, limit: 5 }),
    getCreatableProjects(),
    getMyLoggedHours(),
  ]);

  const completedDelta = kpis.completedThisWeek - kpis.completedLastWeek;

  return (
    <DashboardEntrance>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            Dashboard
          </h1>
          {creatable.length > 0 ? (
            <span data-tour="create-task"><CreateTaskDialog projects={creatable} /></span>
          ) : null}
        </div>

        {/* KPI row — glass stat cards, real numbers from first paint */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-tour="dashboard-kpis">
          <KpiCard
            label="My open tasks"
            value={kpis.openAssigned}
            icon={ListTodo}
            iconClass="text-info"
            caption="assigned to you"
          />
          <KpiCard
            label="Due soon"
            value={kpis.dueSoon}
            icon={CalendarClock}
            iconClass={kpis.overdue > 0 ? "text-danger" : "text-warning"}
            caption={
              kpis.overdue > 0 ? (
                <span className="text-danger font-medium">
                  {kpis.overdue} overdue
                </span>
              ) : (
                "next 7 days"
              )
            }
          />
          <KpiCard
            label="In review"
            value={kpis.inReview}
            icon={Eye}
            iconClass="text-warning"
            caption="awaiting review"
          />
          <KpiCard
            label="Completed this week"
            value={kpis.completedThisWeek}
            icon={CheckCircle2}
            iconClass="text-success"
            delta={{ value: completedDelta, meaning: "up-good" }}
          />
        </div>

        {/* Main bento: 2/3 work + trends, 1/3 inbox + distribution + activity */}
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            <div data-tour="dashboard-mywork">
              <Panel
                title="My work"
                scope="you"
                action={
                  <Link
                    href="/tasks"
                    className="text-primary hover:text-primary-hover focus-visible:ring-ring/50 flex items-center gap-1 rounded text-xs font-medium outline-none focus-visible:ring-2"
                  >
                    View all
                    <ArrowRight aria-hidden className="size-3" />
                  </Link>
                }
              >
                <GroupedWorkList work={work} />
              </Panel>
            </div>

            <Panel title="Throughput — completed per week" scope="team">
              <ThroughputArea data={throughput} />
            </Panel>

            <Panel title="Workload — open tasks by assignee" scope="team">
              <WorkloadBar data={workload} />
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Panel
              title="Inbox"
              scope="you"
              action={
                <Link
                  href="/inbox"
                  className="text-primary hover:text-primary-hover focus-visible:ring-ring/50 flex items-center gap-1 rounded text-xs font-medium outline-none focus-visible:ring-2"
                >
                  View all
                  <ArrowRight aria-hidden className="size-3" />
                </Link>
              }
            >
              <InboxPanel notifications={inbox.items} />
            </Panel>

            <Panel title="My logged hours" scope="you">
              <MyLoggedHours data={loggedHours} />
            </Panel>

            <Panel title="Status distribution" scope="team">
              <StatusDonut data={statusDist} />
            </Panel>

            <Panel title="Recent activity" scope="team">
              <ActivityFeed items={activity} />
            </Panel>
          </div>
        </div>

        {/* Project shortcuts */}
        <section className="flex flex-col gap-3">
          <SectionHeading>Projects</SectionHeading>
          <ProjectTiles tiles={tiles} />
        </section>
      </div>
    </DashboardEntrance>
  );
}
