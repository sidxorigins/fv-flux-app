"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Settings2, ShieldCheck, Trash2, X } from "lucide-react";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Combobox } from "@/features/admin/components/Combobox";

import { deleteEvent, setEventManager, updateEvent } from "../actions";
import type { CrewUser, EventDetail } from "../queries";
import { CrewAvatar } from "./CrewAvatar";

/**
 * Event-level settings. Name/venue/zone for any editor; the managers list and
 * the delete button are Admin-only (the actions re-check either way).
 */
export function EventSettingsDialog({ event, candidates }: { event: EventDetail; candidates: CrewUser[] }) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [name, setName] = React.useState(event.name);
  const [subtitle, setSubtitle] = React.useState(event.subtitle ?? "");
  const [venue, setVenue] = React.useState(event.venue ?? "");
  const [timezone, setTimezone] = React.useState(event.timezone);
  const [pickManager, setPickManager] = React.useState<string | null>(null);

  const managerIds = new Set(event.managers.map((m) => m.id));
  const managerItems = candidates.filter((u) => !managerIds.has(u.id)).map((u) => ({ value: u.id, label: u.name, hint: `@${u.username}` }));

  function save() {
    startTransition(async () => {
      const res = await updateEvent({ eventId: event.id, name, subtitle, venue, timezone });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Event updated");
      setOpen(false);
      router.refresh();
    });
  }

  function toggleManager(userId: string, isManager: boolean) {
    startTransition(async () => {
      const res = await setEventManager({ eventId: event.id, userId, isManager });
      if (!res.ok) { toast.error(res.error); return; }
      setPickManager(null);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteEvent({ eventId: event.id });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Event deleted");
      router.push("/events");
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" size="sm" />}>
          <Settings2 /> Settings
        </DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Event settings</DialogTitle>
            <DialogDescription>Details, who can edit the schedule, and deletion.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="ev-name">Name</FieldLabel>
              <FieldContent>
                <Input id="ev-name" value={name} disabled={isPending} onChange={(e) => setName(e.target.value)} />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="ev-subtitle">Subtitle</FieldLabel>
              <FieldContent>
                <Input id="ev-subtitle" value={subtitle} disabled={isPending} onChange={(e) => setSubtitle(e.target.value)} />
              </FieldContent>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="ev-venue">Venue</FieldLabel>
                <FieldContent>
                  <Input id="ev-venue" value={venue} disabled={isPending} onChange={(e) => setVenue(e.target.value)} />
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="ev-tz">Time zone</FieldLabel>
                <FieldContent>
                  <Input id="ev-tz" value={timezone} placeholder="Europe/Luxembourg" disabled={isPending} onChange={(e) => setTimezone(e.target.value)} />
                  <FieldDescription>IANA zone; decides which day opens as “today”.</FieldDescription>
                </FieldContent>
              </Field>
            </div>

            {event.isAdmin ? (
              <>
                <Separator />
                <Field>
                  <FieldLabel>
                    <ShieldCheck aria-hidden className="mr-1 inline size-3.5 text-primary" />
                    Schedule managers
                  </FieldLabel>
                  <FieldDescription>Non-admins who may edit days, sessions and crew for this event.</FieldDescription>
                  <FieldContent>
                    <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
                      {event.managers.length === 0 ? (
                        <p className="px-1 text-xs text-foreground">Only admins can edit this schedule.</p>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {event.managers.map((m) => (
                            <li key={m.id} className="flex items-center gap-2">
                              <CrewAvatar user={m} />
                              <span className="flex-1 truncate text-sm">{m.name}</span>
                              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${m.name}`} disabled={isPending} onClick={() => toggleManager(m.id, false)}>
                                <X />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex gap-2 border-t border-border pt-2">
                        <Combobox items={managerItems} value={pickManager} onValueChange={setPickManager} placeholder="Add a manager…" disabled={isPending} triggerClassName="h-8 flex-1" />
                        <Button type="button" variant="outline" size="sm" className="h-8" disabled={!pickManager || isPending} onClick={() => pickManager && toggleManager(pickManager, true)}>
                          Add
                        </Button>
                      </div>
                    </div>
                  </FieldContent>
                </Field>
              </>
            ) : null}
          </div>

          <DialogFooter className="sm:justify-between">
            {event.isAdmin ? (
              <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete event
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button onClick={save} disabled={isPending || name.trim().length < 2}>{isPending ? "Saving…" : "Save"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{event.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              All {event.days.length} days, every session and every crew assignment go with it. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>Delete event</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
