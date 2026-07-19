import { getGlobalTimeReport } from "@/features/time/queries"
import { formatMinutes } from "@/features/time/format"
import { HoursBar } from "@/features/time/components/HoursBar"

export default async function AdminTimePage() {
  const report = await getGlobalTimeReport() // requireAdmin() inside — throws for non-admins
  const max = Math.max(1, ...report.byUser.map((r) => r.minutes))
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Time logged across all projects, by user.
      </p>
      <div className="glass flex flex-col gap-1 p-5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Total logged</span>
        <span className="text-3xl font-semibold tabular-nums text-foreground">
          {formatMinutes(report.totalMinutes)}
        </span>
      </div>
      <section className="glass flex flex-col gap-3 p-5">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Hours by user</h2>
        {report.byUser.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time logged yet.</p>
        ) : (
          report.byUser.map((r) => (
            <HoursBar key={r.user.id} label={r.user.name} sub={`@${r.user.username}`} minutes={r.minutes} maxMinutes={max} />
          ))
        )}
      </section>
    </div>
  )
}
