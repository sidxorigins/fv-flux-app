"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
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
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { addDay, deleteDay, updateDay } from "../actions";

/** Editor controls for a day: rename / notes, add another day, delete this day. */
export function DayHeaderEditor({
  eventId,
  slug,
  day,
  canDelete,
}: {
  eventId: string;
  slug: string;
  day: { id: string; title: string | null; notes: string | null; iso: string };
  canDelete: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [editOpen, setEditOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [title, setTitle] = React.useState(day.title ?? "");
  const [notes, setNotes] = React.useState(day.notes ?? "");
  const [newDate, setNewDate] = React.useState("");
  const [newTitle, setNewTitle] = React.useState("");

  function saveDay() {
    startTransition(async () => {
      const res = await updateDay({ dayId: day.id, title, notes });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Day updated");
      setEditOpen(false);
      router.refresh();
    });
  }

  function createDay() {
    startTransition(async () => {
      const res = await addDay({ eventId, date: newDate, title: newTitle });
      if (!res.ok || !res.data) { toast.error(res.ok ? "Something went wrong." : res.error); return; }
      toast.success("Day added");
      setAddOpen(false);
      setNewDate("");
      setNewTitle("");
      router.push(`/events/${slug}?day=${res.data.dayId}`);
      router.refresh();
    });
  }

  function removeDay() {
    startTransition(async () => {
      const res = await deleteDay({ dayId: day.id });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Day removed");
      router.push(`/events/${slug}`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (o) { setTitle(day.title ?? ""); setNotes(day.notes ?? ""); } }}>
        <DialogTrigger render={<Button variant="ghost" size="sm" aria-label="Edit day" />}>
          <Pencil /> Day
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit day</DialogTitle>
            <DialogDescription>Headline and notes shown above the run sheet.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="ed-title">Title</FieldLabel>
              <FieldContent>
                <Input id="ed-title" value={title} placeholder="Standard Competition Day" disabled={isPending} onChange={(e) => setTitle(e.target.value)} />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="ed-notes">Notes</FieldLabel>
              <FieldContent>
                <Textarea id="ed-notes" rows={4} value={notes} placeholder="Public opening hours, reminders…" disabled={isPending} onChange={(e) => setNotes(e.target.value)} />
              </FieldContent>
            </Field>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button onClick={saveDay} disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogTrigger render={<Button variant="ghost" size="sm" aria-label="Add day" />}>
          <CalendarPlus /> Add day
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a day</DialogTitle>
            <DialogDescription>The event range stretches to include it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="ad-date">Date</FieldLabel>
              <FieldContent>
                <Input id="ad-date" type="date" value={newDate} disabled={isPending} onChange={(e) => setNewDate(e.target.value)} />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="ad-title">Title (optional)</FieldLabel>
              <FieldContent>
                <Input id="ad-title" value={newTitle} placeholder="Set-up day" disabled={isPending} onChange={(e) => setNewTitle(e.target.value)} />
              </FieldContent>
            </Field>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button onClick={createDay} disabled={isPending || !newDate}>{isPending ? "Adding…" : "Add day"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canDelete ? (
        <>
          <Button variant="ghost" size="icon-sm" aria-label="Delete day" className="text-muted-foreground hover:text-danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 />
          </Button>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this day?</AlertDialogTitle>
                <AlertDialogDescription>
                  Every session on {day.iso} and its crew assignments will be removed. This can’t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={removeDay}>Delete day</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}
