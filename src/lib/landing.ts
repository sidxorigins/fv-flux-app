// Where a signed-in user lands when no explicit callbackUrl was supplied.
//
// NOT a "use client" module: it is imported by a Server Component
// (app/page.tsx) AND by the client login form. A pure helper re-exported from
// a "use client" file 500s its server callers — keep this module neutral.

import type { GlobalRole } from "@/generated/prisma/enums";

/**
 * An EXECUTIVE's home is the org-wide overview; everyone else starts on their
 * personal dashboard. This only sets a DEFAULT — /dashboard stays reachable
 * from the nav for executives, and an explicit callbackUrl always wins.
 */
export function defaultLandingPath(globalRole: GlobalRole | undefined): string {
  return globalRole === "EXECUTIVE" ? "/executive" : "/dashboard";
}
