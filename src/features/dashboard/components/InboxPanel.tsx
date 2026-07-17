"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import type { NotificationItem } from "@/features/notifications/queries";
import { markNotificationRead } from "@/features/notifications/actions";
import { NotificationRow } from "@/features/notifications/components/NotificationRow";

/**
 * Dashboard inbox glance: the top few notifications (unread first). Clicking one
 * marks it read and opens its task; the panel header links to the full /inbox.
 * Reuses the shared NotificationRow so it matches the bell and the page exactly.
 */
export function InboxPanel({
  notifications,
}: {
  notifications: NotificationItem[];
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(notifications);
  const [syncedProp, setSyncedProp] = React.useState(notifications);
  const [, startTransition] = React.useTransition();

  // Resync to fresh server data (e.g. after router.refresh) without an effect.
  if (syncedProp !== notifications) {
    setSyncedProp(notifications);
    setItems(notifications);
  }

  function openNotification(n: NotificationItem) {
    if (!n.readAt) {
      setItems((prev) =>
        prev.map((it) => (it.id === n.id ? { ...it, readAt: new Date() } : it)),
      );
    }
    startTransition(async () => {
      if (!n.readAt) await markNotificationRead(n.id);
      if (n.projectId && n.taskId) {
        router.push(`/projects/${n.projectId}?task=${n.taskId}`);
      }
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        You&apos;re all caught up.
      </p>
    );
  }

  return (
    <ul className="-mx-2 flex flex-col">
      {items.map((n) => (
        <li key={n.id}>
          <NotificationRow notification={n} onSelect={openNotification} />
        </li>
      ))}
    </ul>
  );
}
