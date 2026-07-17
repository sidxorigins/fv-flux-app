import { getNotificationsPage } from "@/features/notifications/queries"
import { InboxList } from "@/features/notifications/components/InboxList"

/**
 * Inbox — the signed-in user's notification feed as a first-class page (the
 * topbar bell is the quick peek; this is the full list with filtering and
 * pagination). Server-fetches the first page for fast paint; the list hydrates
 * for filter/load-more/mark-read.
 */
export default async function InboxPage() {
  const initialPage = await getNotificationsPage()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Inbox
        </h1>
        <p className="text-sm text-muted-foreground">
          Mentions, assignments, comments, and status changes on your tasks.
        </p>
      </div>
      <InboxList initialPage={initialPage} />
    </div>
  )
}
