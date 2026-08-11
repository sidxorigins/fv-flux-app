import Image from "next/image";
import { AlertTriangle, CheckCircle2, Eye, ListTodo, Radio } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatElapsed } from "@/features/pulse/shape";
import type { OrgPulse, PulseMember } from "@/features/pulse/queries";
import { PriorityBadge } from "@/features/tasks/components/PriorityBadge";
import { cn } from "@/lib/utils";

// Team Pulse at wall scale — the second pane of the /display rotation.
//
// Same no-scroll contract as DisplayBoard: h-screen, fr rows that divide the
// viewport rather than sum past it, clamp() type that scales with the screen.
//
// The member grid is CAPPED rather than allowed to grow: a wall board that
// silently clips the last row is worse than one that says "+4 more". Cards are
// already sorted working-first by sortPulseCards, so the cap drops the least
// interesting people, not arbitrary ones.
const MAX_CARDS = 15;

/**
 * Grid shape for a given number of tiles.
 *
 * A fixed 5x2 grid looks broken for a small team — two cards stranded in the
 * top-left of an 85" screen with dead space below. Tiers keep the tiles large
 * and the board full whether the org has 2 people or 10.
 */
function gridShape(count: number): { cols: number; rows: number } {
  if (count <= 2) return { cols: count || 1, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 8) return { cols: 4, rows: 2 };
  if (count <= 10) return { cols: 5, rows: 2 };
  // Three rows so a whole team fits rather than hiding a third of it behind
  // "+N more" — on a team board the people you can't see are the point.
  if (count <= 12) return { cols: 4, rows: 3 };
  return { cols: 5, rows: 3 };
}

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

export function PulseWallBoard({ data }: { data: OrgPulse }) {
  const shown = data.members.slice(0, MAX_CARDS);
  const hidden = data.members.length - shown.length;
  // The "+N more" tile occupies a cell too, so it counts toward the shape.
  const { cols, rows } = gridShape(shown.length + (hidden > 0 ? 1 : 0));

  return (
    <div className="grid h-screen grid-rows-[auto_auto_1fr] gap-[1.2vh] overflow-hidden p-[1.6vh]">
      <header className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <Image
            src="/foodverse-logo.png"
            alt="Foodverse"
            width={720}
            height={455}
            priority
            className="w-auto object-contain"
            style={{ height: "clamp(2.5rem, 7.5vh, 6.5rem)" }}
          />
          <h1 className="sr-only">Team pulse wall board</h1>
          <span
            className="text-foreground font-semibold"
            style={{ fontSize: "clamp(1rem, 1.6vw, 2.25rem)" }}
          >
            Team
          </span>
        </div>

        <div className="flex items-center gap-5">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-1",
              data.kpis.working > 0
                ? "bg-success/10 text-success"
                : "bg-surface-raised text-muted-foreground",
            )}
            style={{ fontSize: "clamp(0.8rem, 1.05vw, 1.35rem)" }}
          >
            <Radio aria-hidden className="size-[1.1em]" />
            {data.kpis.working} of {data.kpis.headcount} working
          </span>
          <span
            className="text-muted-foreground tabular-nums"
            style={{ fontSize: "clamp(0.7rem, 0.9vw, 1.1rem)" }}
          >
            {data.generatedAt.toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-[1.2vh]">
        <Kpi icon={ListTodo} label="Open tasks" value={data.kpis.open} />
        <Kpi
          icon={AlertTriangle}
          label="Overdue"
          value={data.kpis.overdue}
          tone={data.kpis.overdue > 0 ? "danger" : undefined}
        />
        <Kpi
          icon={Eye}
          label="In review"
          value={data.kpis.inReview}
          tone={data.kpis.inReview > 0 ? "warning" : undefined}
        />
        <Kpi
          icon={CheckCircle2}
          label="Done this week"
          value={data.kpis.completedThisWeek}
          tone={data.kpis.completedThisWeek > 0 ? "success" : undefined}
        />
      </div>

      {data.members.length === 0 ? (
        <div className="glass flex items-center justify-center">
          <span className="text-muted-foreground" style={{ fontSize: "1.5vw" }}>
            No active users
          </span>
        </div>
      ) : (
        <div
          className="grid gap-[1.2vh] overflow-hidden"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            // Caps how tall a single row can get. Without it a two-person org
            // renders two full-height billboards; the grid stays centred in
            // the remaining space instead.
            maxHeight: rows === 1 ? "46vh" : "100%",
            alignSelf: rows === 1 ? "center" : "stretch",
          }}
        >
          {shown.map((m) => (
            <MemberTile key={m.userId} member={m} />
          ))}
          {hidden > 0 ? (
            <div className="glass flex items-center justify-center">
              <span
                className="text-muted-foreground"
                style={{ fontSize: "clamp(0.9rem, 1.2vw, 1.6rem)" }}
              >
                +{hidden} more
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ListTodo;
  label: string;
  value: number;
  tone?: "danger" | "warning" | "success";
}) {
  return (
    <div className="glass flex items-center justify-between gap-3 p-[1.4vh]">
      <span
        className="text-muted-foreground inline-flex items-center gap-2 tracking-wider uppercase"
        style={{ fontSize: "clamp(0.6rem, 0.8vw, 1rem)" }}
      >
        <Icon aria-hidden className="size-[1.2em]" />
        {label}
      </span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          !tone && "text-foreground",
        )}
        style={{ fontSize: "clamp(1.5rem, 2.6vw, 3.5rem)", lineHeight: 1 }}
      >
        {value}
      </span>
    </div>
  );
}

function MemberTile({ member }: { member: PulseMember }) {
  const working = member.availability === "working";
  const task = member.currentTask;

  return (
    <div className="glass flex flex-col gap-[0.8vh] overflow-hidden p-[1.4vh]">
      <div className="flex items-center gap-2">
        <Avatar size="default">
          {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
          <AvatarFallback className="font-medium">
            {initialsOf(member.name)}
          </AvatarFallback>
        </Avatar>
        <span
          className="text-foreground min-w-0 flex-1 truncate font-semibold"
          style={{ fontSize: "clamp(0.8rem, 1.05vw, 1.4rem)" }}
        >
          {member.name}
        </span>
        <span
          aria-hidden
          className={cn(
            "size-[0.55em] shrink-0 rounded-full",
            working ? "bg-success" : "bg-muted-foreground",
          )}
          style={{ fontSize: "clamp(0.8rem, 1.05vw, 1.4rem)" }}
        />
      </div>

      {/* The task box is deliberately NOT flex-1: on a small team the tiles are
          large, and a stretched box reads as a mostly-empty panel. Natural
          height with the stats pinned to the bottom looks right at any
          headcount. */}
      {task ? (
        <div className="bg-surface-raised flex flex-col gap-[0.4vh] rounded-lg p-[1vh]">
          <div className="flex items-center gap-2">
            <span
              className="text-foreground shrink-0 font-mono font-semibold"
              style={{ fontSize: "clamp(0.6rem, 0.75vw, 0.95rem)" }}
            >
              {task.key}
            </span>
            <span className="ml-auto shrink-0">
              <PriorityBadge priority={task.priority} />
            </span>
          </div>
          <p
            className="text-foreground line-clamp-2 leading-snug font-medium"
            style={{ fontSize: "clamp(0.7rem, 0.95vw, 1.25rem)" }}
          >
            {task.title}
          </p>
          {task.minutesOnTask !== null ? (
            <span
              className="text-muted-foreground mt-auto"
              style={{ fontSize: "clamp(0.6rem, 0.75vw, 0.95rem)" }}
            >
              {formatElapsed(task.minutesOnTask)} on this
            </span>
          ) : null}
        </div>
      ) : (
        <div className="border-border text-muted-foreground flex items-center justify-center rounded-lg border border-dashed py-[2vh]">
          <span style={{ fontSize: "clamp(0.65rem, 0.85vw, 1.05rem)" }}>Idle</span>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between">
        <Stat label="Open" value={member.activeCount} />
        <Stat
          label="Overdue"
          value={member.overdue}
          tone={member.overdue > 0 ? "danger" : undefined}
        />
        <Stat label="Done wk" value={member.completedThisWeek} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={cn(
          "font-semibold tabular-nums",
          tone === "danger" ? "text-danger" : "text-foreground",
        )}
        style={{ fontSize: "clamp(0.8rem, 1.1vw, 1.5rem)" }}
      >
        {value}
      </span>
      <span
        className="text-muted-foreground"
        style={{ fontSize: "clamp(0.5rem, 0.65vw, 0.8rem)" }}
      >
        {label}
      </span>
    </div>
  );
}
