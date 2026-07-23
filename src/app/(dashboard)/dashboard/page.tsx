import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { prisma } from "@/lib/db";
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
import { dedupeActivity } from "@/features/dashboard/dedupe-activity";
import { getNotificationsPage } from "@/features/notifications/queries";
import { getMyLoggedHours } from "@/features/time/queries";
import { MyLoggedHours } from "@/features/time/components/MyLoggedHours";
import { StatusDonut } from "@/features/dashboard/components/Charts";
import { ThroughputSpark } from "@/features/dashboard/components/ThroughputSpark";
import { WorkloadBars } from "@/features/dashboard/components/WorkloadBars";
import { HeroBand } from "@/features/dashboard/components/HeroBand";
import { GroupedWorkList } from "@/features/dashboard/components/GroupedWorkList";
import { InboxPanel } from "@/features/dashboard/components/InboxPanel";
import { InboxActivityTabs } from "@/features/dashboard/components/InboxActivityTabs";
import { ActivityFeed } from "@/features/dashboard/components/ActivityFeed";
import { ProjectTiles } from "@/features/dashboard/components/ProjectTiles";
import { DashboardEntrance } from "@/features/dashboard/components/DashboardEntrance";
import { CreateTaskDialog } from "@/features/tasks/components";
import { GuidedTour } from "@/features/onboarding/components/GuidedTour";
import { dashboardTourSteps } from "@/features/onboarding/steps";
import { getTourState } from "@/features/onboarding/queries";
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

/** Glass panel — the dashboard-card chrome. */
function Panel({
  title,
  scope,
  action,
  children,
  className,
}: {
  title?: string;
  scope?: "you" | "team";
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass flex flex-col gap-3 p-5", className)}>
      {title ? (
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-2">
            <SectionHeading>{title}</SectionHeading>
            {scope ? <ScopeChip scope={scope} /> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Cell header inside the Pulse band (no glass — the band is the panel). */
function PulseCell({
  title,
  scope,
  children,
}: {
  title: string;
  scope: "you" | "team";
  children: React.ReactNode;
}) {
  return (
    <div className="border-border flex min-w-0 flex-col gap-3 p-5 sm:not-first:border-l max-sm:not-first:border-t">
      <div className="flex items-center gap-2">
        <SectionHeading>{title}</SectionHeading>
        <ScopeChip scope={scope} />
      </div>
      {children}
    </div>
  );
}

/**
 * The flagship screen — "focus hero + dense grid". Everything fetched
 * server-side in one Promise.all; scope resolves once. Client JS on the page:
 * chart components, the tab toggle, inline status dropdowns, entrance wrapper.
 */
export default async function DashboardPage() {
  const scope = await getDashboardScope();
  const tour = await getTourState();

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
        <GuidedTour
          steps={dashboardTourSteps(scope.isAdmin)}
          autoStart={!tour.completed}
        />
      </div>
    );
  }

  const [
    me,
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
    prisma.user.findUniqueOrThrow({
      where: { id: scope.userId },
      select: { name: true, username: true },
    }),
    getKpis(scope),
    getStatusDistribution(scope),
    getThroughput(scope),
    getWorkload(scope),
    getRecentActivity(20, scope),
    getProjectTiles(scope),
    getMyWorkGrouped(),
    getNotificationsPage({ unreadOnly: true, limit: 5 }),
    getCreatableProjects(),
    getMyLoggedHours(),
  ]);

  const firstName = (me.name.trim().split(/\s+/)[0] || me.username) ?? "there";
  const deduped = dedupeActivity(activity);

  const viewAll = (href: string, label = "View all") => (
    <Link
      href={href}
      className="text-primary hover:text-primary-hover focus-visible:ring-ring/50 flex items-center gap-1 rounded text-xs font-medium outline-none focus-visible:ring-2"
    >
      {label}
      <ArrowRight aria-hidden className="size-3" />
    </Link>
  );

  return (
    <DashboardEntrance>
      <div className="flex flex-col gap-4">
        {/* Hero — greeting, date, summary, CTA, inline KPIs */}
        <HeroBand
          firstName={firstName}
          kpis={kpis}
          cta={
            creatable.length > 0 ? (
              <span data-tour="create-task">
                <CreateTaskDialog projects={creatable} />
              </span>
            ) : undefined
          }
        />

        {/* Work row — agenda 2/3, merged inbox/activity 1/3 */}
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div data-tour="dashboard-mywork" className="min-w-0 lg:col-span-2">
            <Panel title="My work" scope="you" action={viewAll("/tasks")}>
              <GroupedWorkList work={work} />
            </Panel>
          </div>

          <Panel className="min-w-0" title="Updates" scope="you" action={viewAll("/inbox")}>
            <InboxActivityTabs
              unreadCount={inbox.items.length}
              inbox={<InboxPanel notifications={inbox.items} />}
              activity={<ActivityFeed items={deduped} />}
            />
          </Panel>
        </div>

        {/* Projects rail */}
        {tiles.length > 0 ? (
          <section className="flex flex-col gap-3">
            <SectionHeading>Projects</SectionHeading>
            <ProjectTiles tiles={tiles} />
          </section>
        ) : null}

        {/* Pulse band — compact, data-aware team/personal vitals */}
        <section className="glass grid p-0 sm:grid-cols-2 xl:grid-cols-4">
          <PulseCell title="Status" scope="team">
            <StatusDonut data={statusDist} compact />
          </PulseCell>
          <PulseCell title="Throughput" scope="team">
            <ThroughputSpark data={throughput} />
          </PulseCell>
          <PulseCell title="Workload" scope="team">
            <WorkloadBars data={workload} />
          </PulseCell>
          <PulseCell title="My hours" scope="you">
            <MyLoggedHours data={loggedHours} />
          </PulseCell>
        </section>
      </div>

      <GuidedTour
        steps={dashboardTourSteps(scope.isAdmin)}
        autoStart={!tour.completed}
      />
    </DashboardEntrance>
  );
}
