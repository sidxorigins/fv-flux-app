import type { ReactNode } from "react"
import {
  ArrowRightLeft,
  CalendarDays,
  Eye,
  FileX,
  MessageSquareOff,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  Tag,
  UserRound,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

import type { ActivityEntry } from "../activity"
import { PRIORITY_META } from "./PriorityBadge"
import { STATUS_META } from "./StatusBadge"
import { formatDueDate } from "../format"
import { TYPE_META } from "./TypeIcon"

// Server-compatible (no "use client") — this renders once per drawer open /
// router.refresh(), so a plain Intl.RelativeTimeFormat call at render time is
// fine: there's no client hydration to mismatch against (see TimeAgo.tsx for
// the equivalent client-side version, which needs the extra mount dance).
const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
]

function relativeTime(date: Date): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  let duration = (date.getTime() - Date.now()) / 1000
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit)
    }
    duration /= division.amount
  }
  return formatDueDate(date)
}

function humanizeStatus(value: string | null): string {
  return value && value in STATUS_META
    ? STATUS_META[value as keyof typeof STATUS_META].label
    : (value ?? "")
}

function humanizePriority(value: string | null): string {
  return value && value in PRIORITY_META
    ? PRIORITY_META[value as keyof typeof PRIORITY_META].label
    : (value ?? "")
}

function humanizeType(value: string | null): string {
  return value && value in TYPE_META
    ? TYPE_META[value as keyof typeof TYPE_META].label
    : (value ?? "")
}

function iconFor(entry: ActivityEntry): LucideIcon {
  if (entry.field === "status") return ArrowRightLeft
  if (entry.field === "priority") return Tag
  if (entry.field === "assignee") return UserRound
  if (entry.field === "dueDate") return CalendarDays
  if (entry.field === "watcher") return Eye
  switch (entry.action) {
    case "created":
      return Plus
    case "commented":
      return MessageSquareText
    case "comment_deleted":
      return MessageSquareOff
    case "attached":
      return Paperclip
    case "attachment_deleted":
      return FileX
    default:
      return Pencil
  }
}

/** Humanised field-change sentence, e.g. "moved status from TODO to IN_PROGRESS". */
function describe(entry: ActivityEntry): ReactNode {
  const { action, field, oldValue, newValue } = entry
  const mono = (text: string) => (
    <span className="font-mono text-foreground">{text}</span>
  )

  if (field === "status") {
    return oldValue ? (
      <>
        moved status from {mono(humanizeStatus(oldValue))} to{" "}
        {mono(humanizeStatus(newValue))}
      </>
    ) : (
      <>set status to {mono(humanizeStatus(newValue))}</>
    )
  }
  if (field === "priority") {
    return <>set priority to {mono(humanizePriority(newValue))}</>
  }
  if (field === "type") {
    return <>changed type to {mono(humanizeType(newValue))}</>
  }
  if (field === "title") {
    return <>renamed to {mono(`"${newValue}"`)}</>
  }
  if (field === "assignee") {
    return newValue ? "changed the assignee" : "unassigned this task"
  }
  if (field === "watcher") {
    return action === "watcher_removed" ? (
      <>removed {mono(oldValue ?? "someone")} as watcher</>
    ) : (
      <>added {mono(newValue ?? "someone")} as watcher</>
    )
  }
  if (field === "dueDate") {
    return newValue ? (
      <>set due date to {mono(formatDueDate(new Date(newValue)))}</>
    ) : (
      "cleared the due date"
    )
  }
  if (field === "description") return "updated the description"
  if (field === "labels") return "updated labels"

  switch (action) {
    case "created":
      return "created this task"
    case "commented":
      return "commented"
    case "comment_deleted":
      return "deleted a comment"
    case "attached":
      return <>attached {mono(newValue ?? "a file")}</>
    case "attachment_deleted":
      return <>removed {mono(oldValue ?? "a file")}</>
    default:
      return action.replace(/_/g, " ")
  }
}

export function ActivityList({
  entries,
  className,
}: {
  entries: ActivityEntry[]
  className?: string
}) {
  if (entries.length === 0) return null

  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {entries.map((entry) => {
        const Icon = iconFor(entry)
        return (
          <li key={entry.id} className="flex items-start gap-2.5 text-sm">
            <span
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-muted-foreground"
              aria-hidden
            >
              <Icon className="size-3" />
            </span>
            <p className="min-w-0 flex-1 leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">
                {entry.actor.name}
              </span>{" "}
              {describe(entry)}{" "}
              <span
                className="font-mono text-xs text-muted-foreground"
                title={entry.createdAt.toLocaleString()}
              >
                · {relativeTime(entry.createdAt)}
              </span>
            </p>
          </li>
        )
      })}
    </ul>
  )
}
