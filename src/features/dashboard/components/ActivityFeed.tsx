import Link from "next/link";

import type { TaskStatus } from "@/generated/prisma/enums";
// Deep import (server-safe module, no client barrel) for the status labels.
import { STATUS_META } from "@/features/tasks/components/StatusBadge";
import type { DashboardActivity } from "@/features/dashboard/queries";
import { cn } from "@/lib/utils";

// ─── Sentence building ───────────────────────────────────────────────────────
// ActivityLog `action` values written across the app: created, updated, moved,
// status_changed, commented, comment_deleted, attached, attachment_deleted.
// The verb phrase excludes the task key — the key renders as the link.

function statusLabel(value: string | null): string {
  return value && value in STATUS_META
    ? STATUS_META[value as TaskStatus].label
    : "a new status";
}

function describe(item: DashboardActivity): { verb: string; tail?: string } {
  switch (item.action) {
    case "created":
      return { verb: "created" };
    case "commented":
      return { verb: "commented on" };
    case "comment_deleted":
      return { verb: "deleted a comment on" };
    case "attached":
      return {
        verb: "attached a file to",
        tail: item.newValue ? ` — ${item.newValue}` : undefined,
      };
    case "attachment_deleted":
      return { verb: "removed an attachment from" };
    case "moved":
    case "status_changed":
      return { verb: "moved", tail: ` to ${statusLabel(item.newValue)}` };
    case "updated":
      switch (item.field) {
        case "status":
          return { verb: "moved", tail: ` to ${statusLabel(item.newValue)}` };
        case "priority":
          return {
            verb: "set the priority of",
            tail: item.newValue
              ? ` to ${item.newValue.charAt(0)}${item.newValue.slice(1).toLowerCase()}`
              : undefined,
          };
        case "title":
          return { verb: "renamed" };
        case "assignee":
          return { verb: "reassigned" };
        case "dueDate":
          return { verb: "changed the due date of" };
        case "description":
          return { verb: "updated the description of" };
        case "labels":
          return { verb: "updated labels on" };
        default:
          return { verb: "updated" };
      }
    default:
      return { verb: "updated" };
  }
}

/** Coarse relative time — deterministic, no locale APIs. */
function relativeTime(from: Date, now: Date): string {
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - from.getTime()) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * Recent activity across the user's projects — server-rendered sentences with
 * task links, zero client JS. Compact and scrollable; timestamps are relative
 * to render time (the page is per-request dynamic, so they're always fresh).
 */
export function ActivityFeed({ items }: { items: DashboardActivity[] }) {
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No activity yet
      </p>
    );
  }

  const now = new Date();

  return (
    <ul className="-mr-2 flex max-h-[360px] flex-col gap-3 overflow-y-auto pr-2">
      {items.map((item) => {
        const { verb, tail } = describe(item);
        return (
          <li key={item.id} className="flex items-start gap-2.5">
            {/* Plain server-rendered avatar (initials fallback, no JS) */}
            <span
              aria-hidden
              className="bg-surface-raised text-muted-foreground flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-medium"
            >
              {item.actor.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned URL; next/image can't optimise it
                <img
                  src={item.actor.avatarUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                initialsOf(item.actor.name)
              )}
            </span>

            <p className="text-muted-foreground min-w-0 text-sm leading-snug">
              <span className="text-foreground font-medium">
                {item.actor.name}
              </span>{" "}
              {verb}{" "}
              <Link
                href={`/projects/${item.task.projectId}?task=${item.task.id}`}
                title={item.task.title}
                className={cn(
                  "text-foreground hover:text-primary font-mono text-xs underline-offset-2 hover:underline",
                  "focus-visible:ring-ring/50 rounded outline-none focus-visible:ring-2",
                )}
              >
                {item.task.key}
              </Link>
              {tail ?? ""}
              {/* muted-foreground is the contrast floor (CLAUDE.md) — never dimmer */}
              <span className="text-muted-foreground ml-1.5 text-xs whitespace-nowrap">
                {relativeTime(item.createdAt, now)}
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
