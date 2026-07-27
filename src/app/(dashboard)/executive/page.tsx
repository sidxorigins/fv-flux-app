import { redirect } from "next/navigation";

import { AuthorizationError, requireExecutive } from "@/lib/permissions";

/**
 * Executive Overview — org-wide project health for the EXECUTIVE role.
 *
 * SCOPING (deliberate, documented): unlike /dashboard (personal) and /manager
 * (team-scoped), every figure here spans EVERY project regardless of the
 * viewer's memberships. Drill-down is still membership-gated — see Task 9's
 * project cards.
 */
export default async function ExecutivePage() {
  // proxy.ts only checks the JWT, so a token that still says EXECUTIVE/ADMIN
  // but whose DB row has since been suspended or demoted can still reach here
  // — requireExecutive() re-fetches and throws for that race. There's no
  // error.tsx in this app, so an uncaught throw would surface Next's generic
  // error page instead of the friendly redirect the rest of the app uses
  // (mirrors admin/layout.tsx). Do not simplify this back to a bare call.
  try {
    await requireExecutive();
  } catch (err) {
    if (err instanceof AuthorizationError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/login" : "/dashboard");
    }
    throw err;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">
        Overview
      </h1>
    </div>
  );
}
