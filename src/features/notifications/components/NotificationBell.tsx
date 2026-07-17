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
import type { NotificationItem } from "../queries"
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "../actions"
import { NotificationRow } from "./NotificationRow"

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
                <NotificationRow notification={n} onSelect={openNotification} />
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border px-1 py-1">
          <a
            href="/inbox"
            className="block rounded-md px-2 py-1.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            View all in Inbox
          </a>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
