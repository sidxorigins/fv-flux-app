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
  // web analytics refreshing, and vice versa. Both run, both report.
  const [ga4, stores] = await Promise.all([syncGa4Metrics(), syncStoreInstalls()]);

  const ok = ga4.ok && stores.play.ok && stores.appStore.ok;
  // Failures are surfaced as 502 so the timer's logs show them, but the board
  // keeps serving the last good snapshot either way.
  return NextResponse.json({ ok, ga4, stores }, { status: ok ? 200 : 502 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
