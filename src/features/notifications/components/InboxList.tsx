"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckCheck, Inbox as InboxIcon, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { NotificationItem, NotificationsPage } from "../queries"
import {
  fetchNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
} from "../actions"
import { NotificationRow } from "./NotificationRow"

export interface InboxListProps {
  initialPage: NotificationsPage
}

/**
 * The /inbox list: a flat, newest-first feed of the signed-in user's
 * notifications with an unread-only filter, "Mark all read", and cursor
 * "Load more". Clicking a row marks it read and opens its task. Chronological
 * (not split into Unread/Earlier) so rows don't jump around as they're read.
 */
export function InboxList({ initialPage }: InboxListProps) {
  const router = useRouter()
  const [items, setItems] = React.useState<NotificationItem[]>(
    initialPage.items,
  )
  const [cursor, setCursor] = React.useState<string | null>(
    initialPage.nextCursor,
  )
  const [unreadOnly, setUnreadOnly] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [, startTransition] = React.useTransition()

  const hasUnread = items.some((n) => !n.readAt)

  function openNotification(n: NotificationItem) {
    // Optimistically mark read locally, then persist + navigate.
    if (!n.readAt) {
      setItems((prev) =>
        prev.map((it) => (it.id === n.id ? { ...it, readAt: new Date() } : it)),
      )
    }
    startTransition(async () => {
      if (!n.readAt) await markNotificationRead(n.id)
      if (n.projectId && n.taskId) {
        router.push(`/projects/${n.projectId}?task=${n.taskId}`)
      }
      router.refresh() // keep the topbar bell badge in sync
    })
  }

  function markAll() {
    setItems((prev) => prev.map((it) => ({ ...it, readAt: it.readAt ?? new Date() })))
    startTransition(async () => {
      await markAllNotificationsRead()
      // If filtered to unread, the list should now empty out.
      if (unreadOnly) await applyFilter(true)
      router.refresh()
    })
  }

  async function applyFilter(next: boolean) {
    setLoading(true)
    const res = await fetchNotificationsPage({ unreadOnly: next })
    setLoading(false)
    if (!res.ok || !res.data) {
      toast.error(res.ok ? "Couldn't load notifications." : res.error)
      return
    }
    setItems(res.data.items)
    setCursor(res.data.nextCursor)
  }

  function toggleUnreadOnly() {
    const next = !unreadOnly
    setUnreadOnly(next)
    void applyFilter(next)
  }

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    const res = await fetchNotificationsPage({ cursor, unreadOnly })
    setLoading(false)
    if (!res.ok || !res.data) {
      toast.error(res.ok ? "Couldn't load more." : res.error)
      return
    }
    setItems((prev) => [...prev, ...res.data!.items])
    setCursor(res.data.nextCursor)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={unreadOnly ? "default" : "outline"}
            size="sm"
            onClick={toggleUnreadOnly}
            aria-pressed={unreadOnly}
          >
            Unread only
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={markAll}
          disabled={!hasUnread}
          className="text-muted-foreground"
        >
          <CheckCheck aria-hidden />
          Mark all read
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 px-8 py-16 text-center">
          <InboxIcon aria-hidden className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {unreadOnly ? "No unread notifications." : "You're all caught up."}
          </p>
        </div>
      ) : (
        <ul className="glass divide-y divide-border/60 p-1.5">
          {items.map((n) => (
            <li key={n.id}>
              <NotificationRow
                notification={n}
                onSelect={openNotification}
                size="comfortable"
              />
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loading}
            className={cn(loading && "opacity-70")}
          >
            {loading ? (
              <Loader2
                className="animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  )
}
