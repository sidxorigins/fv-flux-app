"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronUp, MapPin, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { deleteSession, moveSession, setSessionCompleted } from "../actions";
import { formatSessionTime } from "../dates";
import type { SessionRow } from "../queries";
import { CrewAvatar } from "./CrewAvatar";
import { PriorityChip, SESSION_PRIORITY_META } from "./PriorityChip";

export interface SessionCardProps {
  session: SessionRow;
  canEdit: boolean;
  /** Owner or crew of this session — may toggle "done" even without edit rights. */
  isMine: boolean;
  onEdit: (session: SessionRow) => void;
}

/**
 * One row on the run sheet. Solid `--surface` (not glass — there can be
 * 20+ per day). Left bar carries the priority colour so a column of rows
 * scans as a heat-map; completed rows dim.
 */
export function SessionCard({ session, canEdit, isMine, onEdit }: SessionCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const done = session.completedAt !== null;
  const meta = SESSION_PRIORITY_META[session.priority];
  const time = formatSessionTime(session);
  const crewShown = session.crew.filter((c) => c.user.id !== session.owner?.id);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { toast.error(res.error ?? "Something went wrong."); return; }
      if (okMsg) toast.success(okMsg);
      router.refresh();
    });
  }

  return (
    <li
      data-done={done || undefined}
      className={cn(
        "group relative flex gap-3 overflow-hidden rounded-xl border border-border bg-surface p-3 pl-4 sm:gap-4 sm:p-4 sm:pl-5",
        "transition-colors duration-150 motion-reduce:transition-none",
        done && "opacity-60",
        isMine && !done && "border-primary/30",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", meta.barClass)} />

      {/* Time column */}
      <div className="flex w-[4.5rem] shrink-0 flex-col pt-0.5 sm:w-24">
        <span className={cn("text-sm font-semibold tabular-nums", session.startTime ? "text-foreground" : "text-muted-foreground")}>
          {time}
        </span>
        {session.location ? (
          <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{session.location}</span>
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={cn("text-sm font-semibold text-foreground sm:text-[15px]", done && "line-through")}>{session.title}</h3>
          <PriorityChip priority={session.priority} />
          {done ? (
            <span className="inline-flex h-5 items-center gap-1 rounded-md bg-success/10 px-1.5 text-[11px] font-semibold text-success uppercase">
              <Check className="size-3" aria-hidden /> Covered
            </span>
          ) : null}
        </div>
        {session.focus ? <p className="text-sm leading-relaxed text-muted-foreground">{session.focus}</p> : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {session.owner ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
              <CrewAvatar user={session.owner} owner />
              <span className="font-medium">{session.owner.name}</span>
              <span className="text-muted-foreground">owner</span>
            </span>
          ) : (
            <span className="text-xs text-danger">No owner</span>
          )}
          {crewShown.length > 0 ? (
            <ul className="flex flex-wrap items-center gap-1.5" aria-label="Crew">
              {crewShown.map((c) => (
                <li key={c.user.id} className="inline-flex items-center gap-1 rounded-full bg-surface-raised py-0.5 pr-2 pl-0.5 text-xs">
                  <CrewAvatar user={c.user} role={c.role} />
                  <span className="text-foreground">{c.user.name.split(" ")[0]}</span>
                  {c.role ? <span className="text-muted-foreground">· {c.role}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        {isMine || canEdit ? (
          <Button
            variant={done ? "secondary" : "outline"}
            size="sm"
            aria-pressed={done}
            disabled={isPending}
            onClick={() => run(() => setSessionCompleted({ sessionId: session.id, completed: !done }))}
          >
            <Check />
            {done ? "Undo" : "Done"}
          </Button>
        ) : null}
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Session actions" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(session)}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => run(() => moveSession({ sessionId: session.id, direction: "up" }))}>
                <ChevronUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => run(() => moveSession({ sessionId: session.id, direction: "down" }))}>
                <ChevronDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              “{session.title}” and its crew assignments will be removed from the run sheet. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => run(() => deleteSession({ sessionId: session.id }), "Session deleted")}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
