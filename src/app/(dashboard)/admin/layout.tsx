import { redirect } from "next/navigation";

import { AuthorizationError, requireAdmin } from "@/lib/permissions";
import { AdminNav } from "@/features/admin/components/AdminNav";

/**
 * Admin area shell.
 *
 * LAYOUT DEVIATION (from CLAUDE.md's suggested `app/admin/`): the admin area
 * lives INSIDE the `(dashboard)` route group so it inherits the authed app shell
 * (glass sidebar + topbar) without duplicating it. The public URL is still
 * `/admin` — route groups don't affect the path — and the `proxy.ts` guard
 * (which matches on `/admin`) is unaffected.
 *
 * Defence in depth: `proxy.ts` does a cheap JWT-only admin check at the edge;
 * this layout re-checks on the server with `requireAdmin()` (which re-fetches the
 * user and requires status ACTIVE), so a non-admin — or a since-suspended admin —
 * is bounced even if they reach the route directly. Never rely on the proxy or a
 * hidden nav link alone (CLAUDE.md "Security Requirements").
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AuthorizationError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/login" : "/dashboard");
    }
    throw err;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage users, invites, and per-project access.
        </p>
      </div>
      <AdminNav />
      <div>{children}</div>
    </div>
  );
}
