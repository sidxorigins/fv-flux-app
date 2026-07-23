"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Merged Inbox / Activity panel — one glass panel, two tabs. The ONLY client
 * state is which tab is visible; both children are server-rendered and passed
 * in, then toggled with `hidden` (no refetch, no remount).
 * Default tab: Inbox when there are unread notifications, else Activity.
 */
export function InboxActivityTabs({
  unreadCount,
  inbox,
  activity,
}: {
  unreadCount: number;
  inbox: React.ReactNode;
  activity: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<"inbox" | "activity">(
    unreadCount > 0 ? "inbox" : "activity",
  );

  const tabButton = (key: "inbox" | "activity", label: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium tracking-wide uppercase",
        "transition-colors duration-150 motion-reduce:transition-none",
        "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
        tab === key
          ? "bg-surface-raised text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Inbox and activity" className="flex gap-1">
        {tabButton(
          "inbox",
          <>
            Inbox
            {unreadCount > 0 ? (
              <span className="bg-primary/12 text-primary ml-1.5 rounded-full px-1.5 tabular-nums">
                {unreadCount}
              </span>
            ) : null}
          </>,
        )}
        {tabButton("activity", "Activity")}
      </div>
      <div role="tabpanel" hidden={tab !== "inbox"}>
        {inbox}
      </div>
      <div role="tabpanel" hidden={tab !== "activity"}>
        {activity}
      </div>
    </div>
  );
}
