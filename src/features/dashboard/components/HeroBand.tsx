import { cn } from "@/lib/utils";
import type { DashboardKpis } from "@/features/dashboard/queries";
import { dubaiDateLine, greetingFor } from "@/features/dashboard/greeting";

/**
 * Dashboard hero: greeting + date + one-line summary on the left, the New-task
 * CTA on the right, and the four KPIs as inline stat blocks along the bottom —
 * hairline-divided, not four separate cards. Server component, zero JS.
 */
export function HeroBand({
  firstName,
  kpis,
  cta,
}: {
  firstName: string;
  kpis: DashboardKpis;
  cta?: React.ReactNode;
}) {
  const now = new Date();
  const completedDelta = kpis.completedThisWeek - kpis.completedLastWeek;

  const summary = [
    `${kpis.openAssigned} open`,
    kpis.overdue > 0 ? `${kpis.overdue} overdue` : null,
    kpis.dueSoon > 0 ? `${kpis.dueSoon} due soon` : null,
    kpis.inReview > 0 ? `${kpis.inReview} in review` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const stats: {
    label: string;
    value: number;
    sub: React.ReactNode;
    alarm?: boolean;
  }[] = [
    { label: "My open tasks", value: kpis.openAssigned, sub: "assigned to you" },
    {
      label: "Due soon",
      value: kpis.dueSoon,
      sub:
        kpis.overdue > 0 ? (
          <span className="text-danger font-medium">{kpis.overdue} overdue</span>
        ) : (
          "next 7 days"
        ),
      alarm: kpis.overdue > 0,
    },
    { label: "In review", value: kpis.inReview, sub: "awaiting review" },
    {
      label: "Completed this week",
      value: kpis.completedThisWeek,
      sub: (
        <span
          className={cn(
            "tabular-nums",
            completedDelta > 0 && "text-success",
          )}
        >
          {completedDelta > 0 ? `+${completedDelta}` : completedDelta} vs last
          week
        </span>
      ),
    },
  ];

  return (
    <section className="glass flex flex-col gap-6 p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">{dubaiDateLine(now)}</p>
          <h1 className="text-foreground mt-1 text-3xl font-semibold tracking-tight">
            Good {greetingFor(now)}, {firstName}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">{summary}</p>
        </div>
        {cta}
      </div>

      <div
        data-tour="dashboard-kpis"
        className="border-border grid grid-cols-2 gap-y-5 border-t pt-5 xl:grid-cols-4"
      >
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className={cn(
              "flex flex-col gap-1 px-4 first:pl-0",
              // hairline dividers between blocks (skip the row start)
              i > 0 && "border-border sm:border-l",
              i === 2 && "max-xl:border-l-0",
            )}
          >
            <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              {stat.label}
            </span>
            <span
              className={cn(
                "text-3xl leading-none font-semibold tracking-tight tabular-nums",
                stat.alarm ? "text-danger" : "text-foreground",
              )}
            >
              {stat.value}
            </span>
            <span className="text-muted-foreground text-[11px]">{stat.sub}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
