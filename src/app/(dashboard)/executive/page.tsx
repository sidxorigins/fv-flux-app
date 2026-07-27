import { requireExecutive } from "@/lib/permissions";

/**
 * Executive Overview — org-wide project health for the EXECUTIVE role.
 *
 * SCOPING (deliberate, documented): unlike /dashboard (personal) and /manager
 * (team-scoped), every figure here spans EVERY project regardless of the
 * viewer's memberships. Drill-down is still membership-gated — see Task 9's
 * project cards.
 */
export default async function ExecutivePage() {
  await requireExecutive();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-foreground text-2xl font-semibold tracking-tight">
        Overview
      </h1>
    </div>
  );
}
