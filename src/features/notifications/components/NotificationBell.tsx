"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bell, CheckCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { NotificationItem } from "../queries"
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "../actions"

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
  for (const d of DIVISIONS) {
    if (Math.abs(duration) < d.amount) return rtf.format(Math.round(duration), d.unit)
    duration /= d.amount
  }
  return date.toLocaleDateString()
}

function sentence(n: NotificationItem): string {
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
    default:
      return `${who} updated this task`
  }
}

export interface NotificationBellProps {
  notifications: NotificationItem[]
  unreadCount: number
}

/**
 * Topbar notification centre. Shows an unread badge on the bell; the dropdown
 * lists recent notifications, marks one read (and navigates to its task) on
 * click, and offers "Mark all read". The data is server-fetched by the topbar
 * and refreshed via router.refresh() after each mutation.
 */
export function NotificationBell({
  notifications,
  unreadCount,
}: NotificationBellProps) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()

  function openNotification(n: NotificationItem) {
    startTransition(async () => {
      if (!n.readAt) await markNotificationRead(n.id)
      if (n.projectId && n.taskId) {
        router.push(`/projects/${n.projectId}?task=${n.taskId}`)
      }
      router.refresh()
    })
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsRead()
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            className="relative text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Bell aria-hidden />
        {unreadCount > 0 ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium text-foreground">
            Notifications
          </span>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={markAll}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <CheckCheck className="size-3.5" aria-hidden />
              Mark all read
            </button>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            You&apos;re all caught up.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-surface-raised",
                    !n.readAt && "bg-primary/5",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {!n.readAt ? (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-primary"
                        aria-hidden
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {sentence(n)}
                    </span>
                  </span>
                  {n.taskKey ? (
                    <span className="truncate pl-3.5 text-xs text-muted-foreground">
                      <span className="font-mono">{n.taskKey}</span>{" "}
                      {n.taskTitle}
                    </span>
                  ) : null}
                  <span className="pl-3.5 text-[11px] text-muted-foreground">
                    {relativeTime(new Date(n.createdAt))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
