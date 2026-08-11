import { redirect } from "next/navigation";

import { DisplayBoard } from "@/features/analytics/components/DisplayBoard";
import { DisplayRefresher } from "@/features/analytics/components/DisplayRefresher";
import { verifyDisplayToken } from "@/features/analytics/displayAuth";
import { getDisplayMetrics } from "@/features/analytics/displayQueries";
import { AuthorizationError, requireAdmin } from "@/lib/permissions";

// Always live — reads MetricSnapshot (two indexed queries), never GA4.
export const dynamic = "force-dynamic";

export default async function DisplayPage({
  searchParams,
}: {
  // Next 16: searchParams is async and must be awaited.
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

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

  const data = await getDisplayMetrics();

  return (
    <>
      {/* Re-fetches on an interval and keeps the screen awake. */}
      <DisplayRefresher intervalSeconds={60} />
      <DisplayBoard data={data} />
    </>
  );
}
