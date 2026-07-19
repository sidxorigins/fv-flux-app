import { formatMinutes } from "../format"

/** A label + static proportional bar (width only; no animation) + value. */
export function HoursBar({ label, sub, minutes, maxMinutes }: {
  label: string
  sub?: string
  minutes: number
  maxMinutes: number
}) {
  const pct = maxMinutes > 0 ? Math.round((minutes / maxMinutes) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 min-w-0 shrink-0">
        <div className="truncate text-sm text-foreground">{label}</div>
        {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
        {formatMinutes(minutes)}
      </div>
    </div>
  )
}
