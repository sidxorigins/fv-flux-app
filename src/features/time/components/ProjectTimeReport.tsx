import { formatMinutes } from "../format"
import type { ProjectTimeReport as Report } from "../queries"
import { HoursBar } from "./HoursBar"

export function ProjectTimeReport({ report }: { report: Report }) {
  const maxUser = Math.max(1, ...(report.byUser ?? []).map((r) => r.minutes))
  const maxTask = Math.max(1, ...(report.byTask ?? []).map((r) => r.minutes))
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="glass flex flex-col gap-1 p-5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Project total</span>
          <span className="text-3xl font-semibold tabular-nums text-foreground">
            {formatMinutes(report.totalMinutes)}
          </span>
        </div>
        <div className="glass flex flex-col gap-1 p-5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Logged by you</span>
          <span className="text-3xl font-semibold tabular-nums text-foreground">
            {formatMinutes(report.myMinutes)}
          </span>
        </div>
      </div>

      {report.byUser ? (
        <section className="glass flex flex-col gap-3 p-5">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Hours by user</h2>
          {report.byUser.length === 0 ? (
            <p className="text-sm text-muted-foreground">No time logged yet.</p>
          ) : (
            report.byUser.map((r) => (
              <HoursBar key={r.user.id} label={r.user.name} sub={`@${r.user.username}`} minutes={r.minutes} maxMinutes={maxUser} />
            ))
          )}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only project managers can see the per-user breakdown.
        </p>
      )}

      {report.byTask && report.byTask.length > 0 ? (
        <section className="glass flex flex-col gap-3 p-5">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Hours by task</h2>
          {report.byTask.map((r) => (
            <HoursBar key={r.task.id} label={r.task.key} sub={r.task.title} minutes={r.minutes} maxMinutes={maxTask} />
          ))}
        </section>
      ) : null}
    </div>
  )
}
