import { formatMinutes } from "../format"
import type { MyLoggedHours as Data } from "../queries"

export function MyLoggedHours({ data }: { data: Data }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-2xl font-semibold tabular-nums text-foreground">
          {formatMinutes(data.thisWeekMinutes)}
        </div>
        <div className="text-xs text-muted-foreground">logged this week</div>
      </div>
      {data.byProject.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {data.byProject.map((r) => (
            <li key={r.project.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-foreground">
                <span className="font-mono text-xs text-muted-foreground">{r.project.key}</span>{" "}
                {r.project.name}
              </span>
              <span className="tabular-nums text-muted-foreground">{formatMinutes(r.minutes)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No time logged yet.</p>
      )}
    </div>
  )
}
