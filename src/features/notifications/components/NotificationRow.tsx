"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import type { NotificationItem } from "../queries"
import { notificationSentence, relativeTime } from "./notificationFormat"

export interface NotificationRowProps {
  notification: NotificationItem
  /** Called when the row is activated; the caller marks-read + navigates. */
  onSelect: (n: NotificationItem) => void
  /** Tighter padding for the compact bell dropdown; roomier on the page. */
  size?: "compact" | "comfortable"
}

/**
 * One notification as a clickable button — shared by the bell dropdown, the
 * dashboard inbox panel, and the /inbox page. Unread rows get a dot + tint; the
 * action (mark read + navigate) is owned by the caller via `onSelect`.
 */
export function NotificationRow({
  notification: n,
  onSelect,
  size = "compact",
}: NotificationRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(n)}
      className={cn(
        "flex w-full flex-col gap-0.5 text-left transition-colors duration-150 hover:bg-surface-raised focus-visible:bg-surface-raised outline-none motion-reduce:transition-none",
        size === "compact" ? "px-3 py-2" : "rounded-lg px-3 py-2.5",
        !n.readAt && "bg-primary/5",
      )}
    >
      <span className="flex items-center gap-2">
        {!n.readAt ? (
          <span
            className="size-1.5 shrink-0 rounded-full bg-primary"
            aria-hidden
          />
        ) : (
          <span className="size-1.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {notificationSentence(n)}
        </span>
      </span>
      {n.taskKey ? (
        <span className="truncate pl-3.5 text-xs text-muted-foreground">
          <span className="font-mono">{n.taskKey}</span> {n.taskTitle}
        </span>
      ) : null}
      <span className="pl-3.5 text-[11px] text-muted-foreground">
        {relativeTime(new Date(n.createdAt))}
      </span>
    </button>
  )
}
