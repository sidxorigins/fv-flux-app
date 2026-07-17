// Due-date reminder digests — internal server helper (NOT a "use server" module).
//
// Time-based (not event-triggered) notification: a cron-hit endpoint calls
// sendDueReminders() once a day to email each assignee a digest of the tasks
// they own that are overdue or due within the next 24h. Stateless — no
// "already reminded" tracking, so the caller is expected to hit this at most
// once/day (see src/app/api/cron/due-reminders/route.ts).

import { prisma } from "@/lib/db";
import { sendDueReminderEmail, type DueReminderTaskInfo } from "@/lib/mail";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure bucket decision for a single task's due date relative to `now`:
 *   - "overdue": dueDate is strictly before now
 *   - "dueSoon": dueDate falls in [now, now + 24h)
 *   - null:      dueDate is 24h+ away — not yet reminder-worthy
 */
export function classifyDue(
  dueDate: Date,
  now: Date,
): "overdue" | "dueSoon" | null {
  if (dueDate < now) return "overdue";
  const windowEnd = new Date(now.getTime() + DAY_MS);
  if (dueDate < windowEnd) return "dueSoon";
  return null;
}

export interface DueReminderDigest {
  email: string;
  name: string;
  overdue: DueReminderTaskInfo[];
  dueSoon: DueReminderTaskInfo[];
}

/**
 * Find every non-Done task with an ACTIVE assignee whose due date is overdue
 * or due within the next 24h, grouped into one digest per assignee.
 */
export async function getDueReminderDigests(
  now: Date = new Date(),
): Promise<DueReminderDigest[]> {
  const windowEnd = new Date(now.getTime() + DAY_MS);

  // A single upper-bound filter (< windowEnd) covers both buckets — classifyDue
  // below sorts each row into "overdue" vs "dueSoon".
  const tasks = await prisma.task.findMany({
    where: {
      status: { not: "DONE" },
      assigneeId: { not: null },
      dueDate: { lt: windowEnd },
      assignee: { status: "ACTIVE" },
    },
    select: {
      key: true,
      title: true,
      projectId: true,
      dueDate: true,
      assignee: { select: { id: true, name: true, email: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const digests = new Map<string, DueReminderDigest>();
  for (const task of tasks) {
    if (!task.assignee || !task.dueDate) continue;
    const bucket = classifyDue(task.dueDate, now);
    if (!bucket) continue;

    const digest = digests.get(task.assignee.id) ?? {
      email: task.assignee.email,
      name: task.assignee.name,
      overdue: [],
      dueSoon: [],
    };
    digest[bucket].push({
      key: task.key,
      title: task.title,
      projectId: task.projectId,
      dueDate: task.dueDate,
    });
    digests.set(task.assignee.id, digest);
  }

  return [...digests.values()];
}

export interface SendDueRemindersResult {
  /** Distinct assignees who had at least one overdue/due-soon task. */
  digests: number;
  /** Emails that reported sent: true. */
  sent: number;
  /** Emails that reported sent: false (unconfigured SMTP or a transport error). */
  failed: number;
}

/**
 * Build digests and email one reminder per assignee. Best-effort like the
 * rest of the mail/notification layer: never throws, always returns a
 * summary the caller (the cron route handler) can report back.
 */
export async function sendDueReminders(): Promise<SendDueRemindersResult> {
  try {
    const digests = await getDueReminderDigests();
    if (digests.length === 0) return { digests: 0, sent: 0, failed: 0 };

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

    const results = await Promise.all(
      digests.map((digest) =>
        sendDueReminderEmail({
          to: digest.email,
          name: digest.name,
          overdue: digest.overdue,
          dueSoon: digest.dueSoon,
          appUrl,
        }),
      ),
    );

    const sent = results.filter((r) => r.sent).length;
    return { digests: digests.length, sent, failed: results.length - sent };
  } catch (err) {
    console.error("[sendDueReminders] failed", err);
    return { digests: 0, sent: 0, failed: 0 };
  }
}
