import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Hourglass,
  ListTodo,
} from "lucide-react";

import { AuthorizationError, requireExecutive } from "@/lib/permissions";
import { KpiCard } from "@/features/dashboard/components/KpiCard";
import { ThroughputSpark } from "@/features/dashboard/components/ThroughputSpark";
import { DashboardEntrance } from "@/features/dashboard/components/DashboardEntrance";
import {
  getAttentionItems,
  getExecutiveKpis,
  getExecutiveScope,
  getOrgThroughput,
  getOrgWorkload,
  getProjectHealth,
} from "@/features/executive/queries";
import { AttentionList } from "@/features/executive/components/AttentionList";
import { OrgThroughputChart } from "@/features/executive/components/OrgThroughputChart";
import { OrgWorkloadBars } from "@/features/executive/components/OrgWorkloadBars";
import { ProjectHealthCard } from "@/features/executive/components/ProjectHealthCard";

/** Small-caps muted section heading — same chrome as /dashboard and /manager. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
      {children}
    </h2>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass flex min-w-0 flex-col gap-3 p-5">
      <SectionHeading>{title}</SectionHeading>
      {children}
    </section>
  );
}

/**
 * Executive Overview — org-wide project health for the EXECUTIVE role.
 *
 * SCOPING (deliberate, documented): unlike /dashboard (personal) and /manager
 * (team-scoped), every figure here spans EVERY project regardless of the
 * viewer's memberships. Drill-down stays membership-gated — cards and rows for
 * projects the viewer cannot open render locked and non-navigable.
 *
 * FAST FIRST: one scope resolve, then six aggregate queries in parallel. The
 * entrance tween runs after paint and never gates data, layout, or clicks.
 */
export default async function ExecutivePage() {
  // Same guard shape as admin/layout.tsx: requireExecutive() throws when the DB
  // disagrees with a still-valid JWT (suspended or demoted since it was issued).
  // The app has no error.tsx, so an uncaught throw would surface Next's generic
  // error page instead of the redirect the rest of the app uses for this race.
  try {
    await requireExecutive();
  } catch (err) {
    if (err instanceof AuthorizationError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/login" : "/dashboard");
    }
    throw err;
  }

  const scope = await getExecutiveScope();
  // Only the two membership-aware queries take the scope — it decides which
  // cards and rows are clickable. The rest are purely org-wide.
  const [kpis, throughput, attention, projects, workload] = await Promise.all([
    getExecutiveKpis(),
    getOrgThroughput(),
    getAttentionItems(scope),
    getProjectHealth(scope),
    getOrgWorkload(),
  ]);

  const sparkData = throughput.map((w) => ({
    label: w.label,
    completed: w.completed,
  }));

  return (
    <DashboardEntrance>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            Overview
          </h1>
          <p className="text-muted-foreground text-sm">
            Every project across the organisation.
          </p>
        </div>

        {/* A. Org KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Open work"
            value={kpis.open}
            icon={ListTodo}
            iconClass="text-info"
            delta={{ value: kpis.open - kpis.openLastWeek, meaning: "up-bad" }}
          />
          <KpiCard
            label="Completed this week"
            value={kpis.completedThisWeek}
            icon={CheckCircle2}
            iconClass="text-success"
            delta={{
              value: kpis.completedThisWeek - kpis.completedLastWeek,
              meaning: "up-good",
            }}
          />
          <KpiCard
            label="Overdue"
            value={kpis.overdue}
            icon={AlertTriangle}
            iconClass="text-danger"
            delta={{
              value: kpis.overdue - kpis.overdueLastWeek,
              meaning: "up-bad",
            }}
          />
          <KpiCard
            label="In review"
            value={kpis.inReview}
            icon={Hourglass}
            iconClass="text-warning"
            caption="awaiting sign-off"
          />
        </div>

        <div className="glass p-5">
          <ThroughputSpark data={sparkData} />
        </div>

        {/* B. Attention + throughput */}
        {/*
          grid-cols-1 is explicit (not left to the implicit default) and both
          items get min-w-0: without it, CSS grid's implicit single-column
          track auto-sizes to the items' max-content width, and AttentionList's
          `truncate` title forces `white-space: nowrap`, so its untruncated
          text width leaks into that calculation — the panel silently clips
          past the viewport at narrow widths with no scrollbar to reveal it.
        */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <Panel title="Needs attention">
              <AttentionList items={attention} />
            </Panel>
          </div>
          <Panel title="Created vs completed">
            <OrgThroughputChart data={throughput} />
          </Panel>
        </div>

        {/* C. Project health board */}
        <div className="flex flex-col gap-3">
          <SectionHeading>Projects</SectionHeading>
          {projects.length === 0 ? (
            <p className="text-muted-foreground text-sm">No projects yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <ProjectHealthCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </div>

        {/* D. People & workload */}
        <Panel title="People & workload">
          <OrgWorkloadBars data={workload} />
        </Panel>
      </div>
    </DashboardEntrance>
  );
}
