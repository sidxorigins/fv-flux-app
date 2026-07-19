// Shared, client-safe formatting for notifications — used by the topbar bell,
// the dashboard inbox panel, and the /inbox page so their wording/relative-time
// never diverge.

import type { NotificationItem } from "../queries"

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
]

export function relativeTime(date: Date): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  let duration = (date.getTime() - Date.now()) / 1000
  for (const d of DIVISIONS) {
    if (Math.abs(duration) < d.amount) return rtf.format(Math.round(duration), d.unit)
    duration /= d.amount
  }
  return date.toLocaleDateString()
}

/** Human sentence for a notification, by type. */
export function notificationSentence(n: NotificationItem): string {
  const who = n.actorName ?? "Someone"
  switch (n.type) {
    case "TASK_ASSIGNED":
      return `${who} assigned this task to you`
    case "TASK_MENTIONED":
      return `${who} mentioned you in a comment`
    case "TASK_COMMENTED":
      return `${who} commented`
    case "TASK_STATUS_CHANGED":
      return `${who} changed the status`
    case "TASK_WATCHER_ADDED":
      return `${who} added you as a watcher`
    default:
      return `${who} updated this task`
  }
}
