import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/AppShell";
import { AuthorizationError, requireUser } from "@/lib/permissions";

export default async function DashboardGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the user once at the top of the group. `proxy.ts` only checks that
  // a JWT exists, so a session it waves through can still be refused here —
  // the account was suspended, or a password reset revoked every session
  // issued before it. Without this, that refusal surfaces from whichever
  // nested server component calls requireUser first (the sidebar's unread
  // count, in practice) and the user gets a server-error page instead of
  // being sent to sign in.
  //
  // requireUser is request-memoised with React cache(), so the pages below
  // reuse this lookup rather than paying for a second one.
  try {
    await requireUser();
  } catch (err) {
    if (err instanceof AuthorizationError) {
      // Both codes end at sign-in: a suspended user is refused again by
      // `authorize()`, so there is no redirect loop.
      redirect("/login");
    }
    throw err;
  }

  return <AppShell>{children}</AppShell>;
}
