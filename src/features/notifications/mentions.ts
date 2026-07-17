// @mention parsing + notification. Internal server helper (not "use server").
//
// Comments are sanitised HTML. We extract plain text, find @username tokens,
// resolve them against the project's members, and notify + email each mentioned
// user. Usernames are `[a-z0-9_]`, 3–30 chars (see the shared username schema),
// so the token regex mirrors that. Best-effort: never throws.

import { prisma } from "@/lib/db";
import { sendMentionEmail } from "@/lib/mail";
import { notify } from "./service";

/** Strip tags to plain text (comments are already sanitised HTML). */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const MENTION_RE = /@([a-z0-9_]{3,30})/gi;

/** Distinct lowercased usernames mentioned in a comment body (HTML). */
export function extractMentionUsernames(html: string): string[] {
  const text = htmlToText(html);
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

interface NotifyMentionsParams {
  taskId: string;
  projectId: string;
  actorId: string;
  /** Sanitised comment HTML. */
  html: string;
}

/**
 * Notify every project member @mentioned in a comment (except the author and
 * non-active users). Returns the ids that were notified so the caller can skip
 * them in the plain "commented" fan-out. Never throws.
 */
export async function notifyMentions(
  params: NotifyMentionsParams,
): Promise<string[]> {
  try {
    const usernames = extractMentionUsernames(params.html);
    if (usernames.length === 0) return [];

    // Only members of THIS project can be mentioned (no cross-project pings).
    const members = await prisma.user.findMany({
      where: {
        username: { in: usernames },
        status: "ACTIVE",
        memberships: { some: { projectId: params.projectId } },
      },
      select: { id: true, name: true, email: true },
    });
    const recipients = members
      .map((m) => m.id)
      .filter((id) => id !== params.actorId);
    if (recipients.length === 0) return [];

    await notify({
      recipientIds: recipients,
      actorId: params.actorId,
      type: "TASK_MENTIONED",
      taskId: params.taskId,
    });

    // Email each mentioned member.
    const task = await prisma.task.findUnique({
      where: { id: params.taskId },
      select: {
        key: true,
        title: true,
        projectId: true,
        project: { select: { name: true } },
      },
    });
    const actor = await prisma.user.findUnique({
      where: { id: params.actorId },
      select: { name: true },
    });
    if (task && actor) {
      const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
      const url = `${base}/projects/${task.projectId}?task=${params.taskId}`;
      await Promise.all(
        members
          .filter((m) => m.id !== params.actorId)
          .map((m) =>
            sendMentionEmail({
              to: m.email,
              taskKey: task.key,
              taskTitle: task.title,
              projectName: task.project.name,
              mentionedByName: actor.name,
              taskUrl: url,
            }),
          ),
      );
    }

    return recipients;
  } catch (err) {
    console.error("[notifyMentions] failed", err);
    return [];
  }
}
