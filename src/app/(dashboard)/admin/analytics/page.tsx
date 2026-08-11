import { AlertTriangle } from "lucide-react";

import { AnalyticsScopePanel } from "@/features/analytics/components/AnalyticsScopePanel";
import { getAnalyticsOverview } from "@/features/analytics/queries";

// Live board — always re-render. Data comes from MetricSnapshot (cheap), never
// from GA4 directly, so "dynamic" costs a couple of indexed queries, not an
// external API call.
export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const overview = await getAnalyticsOverview(); // requireAdmin() inside

  if (!overview.configured) {
    return (
      <Notice
        title="Analytics not configured"
        body="Set GA4_PROPERTY_ID, GA_SA_CLIENT_EMAIL and GA_SA_PRIVATE_KEY, then run the metrics sync."
      />
    );
  }

  if (overview.scopes.length === 0) {
    return (
      <Notice
        title="No data yet"
        body="GA4 is configured but no snapshots have been stored. Trigger POST /api/cron/metrics-sync with the CRON_SECRET, or wait for the scheduled run."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Foodverse product analytics from Google Analytics 4.
        </p>
        <span className="text-muted-foreground text-xs tabular-nums">
          {overview.latestDay ? `through ${overview.latestDay} · ` : ""}
          synced{" "}
          {overview.lastSyncedAt
            ? overview.lastSyncedAt.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "never"}
        </span>
      </div>

      {/* Scopes stack vertically: each is now a full bento block, and side by
          side they'd halve the hero numbers this board exists to make big. */}
      <div className="flex flex-col gap-10">
        {overview.scopes.map((scope) => (
          <AnalyticsScopePanel
            key={scope.scope}
            metrics={scope}
            appInstalls={overview.appInstalls}
          />
        ))}
      </div>

      {/* Until app events arrive there is no iOS/Android scope to render, and a
          silent absence would read as "the app has no users" rather than
          "we aren't receiving app data yet". */}
      {overview.scopes.every((s) => s.scope === "web") ? (
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <AlertTriangle aria-hidden className="text-warning mt-0.5 size-3.5 shrink-0" />
          No mobile app data yet. The Android and iOS streams were linked on 10 Aug
          2026 — app metrics appear here once events start arriving. Website figures
          are unaffected.
        </p>
      ) : null}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="glass flex flex-col gap-2 p-6">
      <h2 className="text-foreground text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm">{body}</p>
    </div>
  );
}
