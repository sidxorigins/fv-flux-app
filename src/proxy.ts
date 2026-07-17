// Route protection (Next 16 `proxy.ts` — the renamed `middleware.ts`).
//
// Next 16 requires this file to export a function named `proxy` (or a default
// export); an optional `config.matcher` scopes it. See the file convention docs:
//   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
//
// This layer does CHEAP, JWT-only gating: is there a session? is it an admin? It
// reads the JWT with `getToken` (jose-based, no DB, edge-safe) and never touches
// Prisma. Real authorisation — active status, per-project roles — is re-checked on
// the server in `lib/permissions.ts`, per CLAUDE.md ("never rely on a hidden nav
// link / proxy alone as protection").

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Public paths reachable without a session. Auth.js endpoints (/api/auth/*) must
// stay open so the sign-in flow itself can run.
const PUBLIC_PREFIXES = ["/login", "/register", "/set-password"];

function isPublicPath(pathname: string): boolean {
  // Landing page — exact match only; everything under / stays guarded.
  if (pathname === "/") return true;
  if (pathname.startsWith("/api/auth")) return true;
  // Cron webhooks authenticate themselves with CRON_SECRET inside the route
  // handler — they must bypass the session gate (there's no user session).
  if (pathname.startsWith("/api/cron")) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    // In production the session cookie is `__Secure-authjs.session-token`.
    secureCookie: process.env.NODE_ENV === "production",
  });

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  // Admin area: global ADMIN only. Non-admins are bounced to their dashboard
  // rather than the login page (they're authenticated, just not authorised).
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (token.globalRole !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Auth.js routes, Next internals, and static assets.
  // The trailing `.*\\..*` alternative skips any path containing a dot — i.e.
  // files served from /public (logos, images); app routes never contain dots.
  // Note: server actions POST to their own page route, so those stay covered.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
