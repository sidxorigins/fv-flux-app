import { redirect } from "next/navigation";

import { DisplayBoard } from "@/features/analytics/components/DisplayBoard";
import { DisplayWakeLock } from "@/features/analytics/components/DisplayWakeLock";
import { DisplayRotator } from "@/features/analytics/components/DisplayRotator";
import { verifyDisplayToken } from "@/features/analytics/displayAuth";
import { getDisplayMetrics } from "@/features/analytics/displayQueries";
import { clampRotationSeconds } from "@/features/admin/display/rotation";
import { getRotationSeconds } from "@/features/admin/display/settings";
import { PulseWallBoard } from "@/features/pulse/components/PulseWallBoard";
import { loadOrgPulse } from "@/features/pulse/queries";
import { AuthorizationError, requireAdmin } from "@/lib/permissions";

// Always live — reads MetricSnapshot (two indexed queries), never GA4.
export const dynamic = "force-dynamic";

export default async function DisplayPage({
  searchParams,
}: {
  // Next 16: searchParams is async and must be awaited.
  searchParams: Promise<{ token?: string; screen?: string; interval?: string }>;
}) {
  const { token, screen, interval } = await searchParams;

  // A DisplayToken is checked FIRST so the wall-mounted mini PC never needs a
  // logged-in admin session sitting in an unattended browser. Falls back to an
  // admin session so a human can just open /display.
  const access = await verifyDisplayToken(token);
  if (!access.ok) {
    try {
      await requireAdmin();
    } catch (err) {
      if (err instanceof AuthorizationError) {
        redirect(err.code === "UNAUTHENTICATED" ? "/login" : "/dashboard");
      }
      throw err;
    }
  }

  // Both panes are fetched server-side in one pass so rotating between them
  // costs nothing at runtime — no fetch, no spinner, no flash.
  const [metrics, pulse, configuredRotation] = await Promise.all([
    getDisplayMetrics(),
    // Respects the per-user toggle configured at /admin/display.
    loadOrgPulse({ includeHiddenFromWallBoard: false }),
    getRotationSeconds(),
  ]);

  const allPanes = [
    { key: "analytics", node: <DisplayBoard data={metrics} /> },
    { key: "pulse", node: <PulseWallBoard data={pulse} /> },
  ];

  // ?screen=analytics|pulse pins a single pane — useful for a second screen
  // that should only ever show one, and for debugging a specific board.
  const panes = screen
    ? allPanes.filter((p) => p.key === screen)
    : allPanes;

  // ?interval=N overrides the admin-configured period for this screen only —
  // handy for a second display that should cycle at a different pace. Clamped
  // so a typo can't leave the wall strobing or frozen.
  //
  // Coinciding with the 60s data refresh is harmless: router.refresh() patches
  // the tree in place rather than remounting, so a refresh landing
  // mid-rotation causes no visible disruption.
  const parsed = Number(interval);
  const rotationSeconds = interval && Number.isFinite(parsed)
    ? clampRotationSeconds(parsed)
    : configuredRotation;

  return (
    <>
      {/* Keeps the TV awake. Data refreshing is driven by the rotator, so it
          happens on every screen change rather than on a separate clock. */}
      <DisplayWakeLock />
      <DisplayRotator
        panes={panes.length > 0 ? panes : allPanes}
        intervalSeconds={rotationSeconds}
      />
    </>
  );
}
