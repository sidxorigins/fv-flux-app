// Cron-triggered GA4 → MetricSnapshot sync. A webhook-style endpoint, so a
// Route Handler is correct here (CLAUDE.md: Route Handlers are for webhooks /
// external callers, not app mutations) — the caller is a systemd timer, not a
// browser.
//
// Auth: shared secret only, identical to /api/cron/due-reminders — CRON_SECRET
// must be set AND match `Authorization: Bearer <secret>` or `x-cron-secret`.
// Unset secret means the job never runs.
//
// Cadence: every ~5 minutes. The realtime figure is only as fresh as the last
// run, which is the point — the wall board reads MetricSnapshot and never
// calls Google, so a 20s display refresh costs zero GA4 quota.

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { syncGa4Metrics } from "@/features/analytics/sync";
import { syncStoreInstalls } from "@/features/analytics/storeSync";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  if (bearer && safeEqual(bearer, secret)) return true;

  const cronHeader = request.headers.get("x-cron-secret");
  if (cronHeader && safeEqual(cronHeader, secret)) return true;

  return false;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // GA4 and the store APIs are independent: a broken Apple key must not stop
  // web analytics refreshing, and vice versa. All run, all report.
  const [ga4, stores] = await Promise.all([syncGa4Metrics(), syncStoreInstalls()]);

  const storeFailures = Object.entries(stores)
    .filter(([, r]) => !r.ok)
    .map(([name]) => name);

  // HTTP status reflects the CORE sync only.
  //
  // A store credential can be legitimately pending for days (a Play Console
  // permission takes up to 24h to reach the storage bucket). If that returned
  // non-2xx, the systemd timer would sit permanently failed and a REAL outage
  // would look identical to the known-pending one. Store problems are reported
  // in the body and visible via `degraded`; only a GA4 failure — which empties
  // the board — is worth failing the job over.
  const degraded = storeFailures.length > 0;
  return NextResponse.json(
    { ok: ga4.ok, degraded, degradedSources: storeFailures, ga4, stores },
    { status: ga4.ok ? 200 : 502 },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
