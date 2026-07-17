// Cron-triggered due-date reminder digest. A webhook-style endpoint — a REST
// Route Handler is correct here (per CLAUDE.md, Route Handlers are for
// webhooks / external callers, not app mutations) since an external cron
// scheduler is the caller, not a browser.
//
// Auth: shared-secret only. CRON_SECRET must be set AND match either the
// `Authorization: Bearer <secret>` header or the `x-cron-secret` header —
// no session, no cookie. If CRON_SECRET is unset, the job never runs.
//
// Stateless: no "already reminded" tracking. Intended to be hit at most
// once/day by the scheduler; see sendDueReminders() for the window logic.

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { sendDueReminders } from "@/features/notifications/reminders";
import { sweepOrphanDraftAttachments } from "@/features/attachments/cleanup";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // Never run the job unauthenticated / unconfigured.

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

  // Daily maintenance: reminder digests + orphan comment-draft cleanup. Sweep
  // failures shouldn't fail the whole job, so it's reported separately.
  const result = await sendDueReminders();
  let draftSweep: Awaited<ReturnType<typeof sweepOrphanDraftAttachments>> | { error: string };
  try {
    draftSweep = await sweepOrphanDraftAttachments();
  } catch {
    draftSweep = { error: "sweep_failed" };
  }
  return NextResponse.json({ ok: true, ...result, draftSweep });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
