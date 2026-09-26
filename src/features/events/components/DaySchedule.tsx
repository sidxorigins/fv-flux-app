"use client";

import * as React from "react";
import { CalendarX2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SessionPriority } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import type { CrewUser, SessionRow } from "../queries";
import { SESSION_PRIORITY_META, SESSION_PRIORITY_ORDER } from "./PriorityChip";
import { SessionCard } from "./SessionCard";
import { SessionDialog } from "./SessionDialog";

export interface DayScheduleProps {
  dayId: string;
  sessions: SessionRow[];
  canEdit: boolean;
  currentUserId: string;
  candidates: CrewUser[];
}

function Chip({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium",
        "transition-colors duration-150 motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "border-primary/50 bg-primary/10 text-foreground" : "border-border bg-transparent text-muted-foreground hover:bg-surface-raised hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * The day's session list with client-side filters (mine / priority / hall)
 * and the create/edit dialog. Filters are local state: a day is ~20 rows, so
 * re-fetching for a filter would be slower than filtering in place.
 */
export function DaySchedule({ dayId, sessions, canEdit, currentUserId, candidates }: DayScheduleProps) {
  const [mineOnly, setMineOnly] = React.useState(false);
  const [hideDone, setHideDone] = React.useState(false);
  const [priorities, setPriorities] = React.useState<Set<SessionPriority>>(new Set());
  const [hall, setHall] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SessionRow | null>(null);
  // Bumped on every open so SessionDialog remounts and re-seeds from `editing`.
  const [dialogKey, setDialogKey] = React.useState(0);

  const isMine = React.useCallback(
    (s: SessionRow) => s.owner?.id === currentUserId || s.crew.some((c) => c.user.id === currentUserId),
    [currentUserId],
  );

  const halls = React.useMemo(
    () => [...new Set(sessions.map((s) => s.location).filter((l): l is string => !!l))].sort(),
    [sessions],
  );

  const visible = sessions.filter((s) => {
    if (mineOnly && !isMine(s)) return false;
    if (hideDone && s.completedAt) return false;
    if (priorities.size > 0 && !priorities.has(s.priority)) return false;
    if (hall && s.location !== hall) return false;
    return true;
  });

  function togglePriority(p: SessionPriority) {
    setPriorities((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  function openCreate() {
    setEditing(null);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }
  function openEdit(s: SessionRow) {
    setEditing(s);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  const filtered = visible.length !== sessions.length;

  return (
    <section aria-label="Sessions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>
          Mine
        </Chip>
        <Chip active={hideDone} onClick={() => setHideDone((v) => !v)}>
          Hide covered
        </Chip>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        {SESSION_PRIORITY_ORDER.map((p) => (
          <Chip key={p} active={priorities.has(p)} onClick={() => togglePriority(p)}>
            <span aria-hidden className={cn("size-1.5 rounded-full", SESSION_PRIORITY_META[p].barClass)} />
            {SESSION_PRIORITY_META[p].label}
          </Chip>
        ))}
        {halls.length > 1 ? (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
            {halls.map((h) => (
              <Chip key={h} active={hall === h} onClick={() => setHall((cur) => (cur === h ? null : h))}>
                {h}
              </Chip>
            ))}
          </>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {filtered ? `${visible.length} of ${sessions.length}` : `${sessions.length}`} sessions
          </span>
          {canEdit ? (
            <Button size="sm" onClick={openCreate}>
              <Plus />
              Add session
            </Button>
          ) : null}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <CalendarX2 aria-hidden className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {sessions.length === 0 ? "Nothing scheduled on this day yet" : "No sessions match these filters"}
          </p>
          {sessions.length === 0 && canEdit ? (
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus /> Add the first session
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((s) => (
            <SessionCard key={s.id} session={s} canEdit={canEdit} isMine={isMine(s)} onEdit={openEdit} />
          ))}
        </ul>
      )}

      {canEdit ? (
        <SessionDialog key={dialogKey} open={dialogOpen} onOpenChange={setDialogOpen} dayId={dayId} session={editing} candidates={candidates} />
      ) : null}
    </section>
  );
}
