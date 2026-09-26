"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Crown, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/features/admin/components/Combobox";
import type { SessionPriority } from "@/generated/prisma/enums";

import { createSession, removeAssignment, updateSession, upsertAssignment } from "../actions";
import type { CrewUser, SessionRow } from "../queries";
import { clockTime } from "../schemas";
import { CrewAvatar } from "./CrewAvatar";
import { SESSION_PRIORITY_META, SESSION_PRIORITY_ORDER } from "./PriorityChip";

const UNASSIGNED = "UNASSIGNED";

const PRIORITY_ITEMS: Record<string, string> = Object.fromEntries(
  SESSION_PRIORITY_ORDER.map((p) => [p, SESSION_PRIORITY_META[p].label]),
);

// Plain-input fields go through react-hook-form; priority/owner are Selects
// kept in useState (see CreateTaskDialog for why `watch()` is avoided).
const formSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  location: z.string().trim().max(80),
  startTime: clockTime.or(z.literal("")),
  endTime: clockTime.or(z.literal("")),
  timeLabel: z.string().trim().max(40),
  focus: z.string().trim().max(2000),
});
type FormValues = z.infer<typeof formSchema>;

interface PendingCrew {
  user: CrewUser;
  role: string;
}

export interface SessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayId: string;
  /** Null = create mode. */
  session: SessionRow | null;
  candidates: CrewUser[];
}

/**
 * Create / edit a run-sheet session. In edit mode crew changes save
 * immediately (like ProjectMembersEditor); in create mode they're queued and
 * applied right after the session row exists, so a coordinator can build the
 * whole slot in one go.
 *
 * The parent remounts this component (React `key`) every time it opens, so
 * all form state seeds from `session` in the initialisers — no sync effect.
 */
export function SessionDialog({ open, onOpenChange, dayId, session, candidates }: SessionDialogProps) {
  const router = useRouter();
  const editing = session !== null;
  const [isPending, startTransition] = React.useTransition();
  const [priority, setPriority] = React.useState<SessionPriority>(session?.priority ?? "HIGH");
  const [ownerId, setOwnerId] = React.useState(session?.owner?.id ?? UNASSIGNED);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Crew state — mirrors the server in edit mode, local queue in create mode.
  const [crew, setCrew] = React.useState<PendingCrew[]>(
    session?.crew.map((c) => ({ user: c.user, role: c.role ?? "" })) ?? [],
  );
  const [pickUserId, setPickUserId] = React.useState<string | null>(null);
  const [pickRole, setPickRole] = React.useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: session?.title ?? "",
      location: session?.location ?? "",
      startTime: session?.startTime ?? "",
      endTime: session?.endTime ?? "",
      timeLabel: session?.timeLabel ?? "",
      focus: session?.focus ?? "",
    },
  });


  const ownerItems: Record<string, string> = {
    [UNASSIGNED]: "No owner",
    ...Object.fromEntries(candidates.map((u) => [u.id, u.name])),
  };
  const crewIds = new Set(crew.map((c) => c.user.id));
  const pickItems = candidates
    .filter((u) => !crewIds.has(u.id))
    .map((u) => ({ value: u.id, label: u.name, hint: `@${u.username}` }));

  function addCrew() {
    const user = candidates.find((u) => u.id === pickUserId);
    if (!user) return;
    const role = pickRole.trim();
    if (editing) {
      startTransition(async () => {
        const res = await upsertAssignment({ sessionId: session.id, userId: user.id, role });
        if (!res.ok) { toast.error(res.error); return; }
        setCrew((prev) => [...prev, { user, role }]);
        setPickUserId(null);
        setPickRole("");
        router.refresh();
      });
    } else {
      setCrew((prev) => [...prev, { user, role }]);
      setPickUserId(null);
      setPickRole("");
    }
  }

  function removeCrew(userId: string) {
    if (editing) {
      startTransition(async () => {
        const res = await removeAssignment({ sessionId: session.id, userId });
        if (!res.ok) { toast.error(res.error); return; }
        setCrew((prev) => prev.filter((c) => c.user.id !== userId));
        router.refresh();
      });
    } else {
      setCrew((prev) => prev.filter((c) => c.user.id !== userId));
    }
  }

  function commitRole(userId: string, role: string) {
    const current = crew.find((c) => c.user.id === userId);
    if (!current || !editing || current.role === role) return;
    startTransition(async () => {
      const res = await upsertAssignment({ sessionId: session.id, userId, role });
      if (!res.ok) { toast.error(res.error); return; }
      router.refresh();
    });
  }

  const onSubmit = (values: FormValues) => {
    setFormError(null);
    const payload = {
      title: values.title,
      location: values.location,
      focus: values.focus,
      startTime: values.startTime,
      endTime: values.endTime,
      timeLabel: values.timeLabel,
      priority,
      ownerId: ownerId === UNASSIGNED ? null : ownerId,
    };
    startTransition(async () => {
      if (editing) {
        const res = await updateSession({ sessionId: session.id, ...payload });
        if (!res.ok) { setFormError(res.error); return; }
        toast.success("Session updated");
      } else {
        const res = await createSession({ dayId, ...payload });
        if (!res.ok || !res.data) { setFormError(res.ok ? "Something went wrong." : res.error); return; }
        for (const c of crew) {
          const r = await upsertAssignment({ sessionId: res.data.sessionId, userId: c.user.id, role: c.role });
          if (!r.ok) toast.error(`Couldn't add ${c.user.name}: ${r.error}`);
        }
        toast.success("Session added");
      }
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit session" : "New session"}</DialogTitle>
          <DialogDescription>
            {editing ? "Change the slot, its owner, or the crew." : "Add a slot to this day's run sheet."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!errors.title || undefined}>
              <FieldLabel htmlFor="es-title">Title</FieldLabel>
              <FieldContent>
                <Input id="es-title" autoComplete="off" aria-invalid={!!errors.title} disabled={isPending} {...register("title")} />
                <FieldError errors={[errors.title]} />
              </FieldContent>
            </Field>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field data-invalid={!!errors.startTime || undefined}>
                <FieldLabel htmlFor="es-start">Start</FieldLabel>
                <FieldContent>
                  <Input id="es-start" type="time" step={300} disabled={isPending} aria-invalid={!!errors.startTime} {...register("startTime")} />
                  <FieldError errors={[errors.startTime]} />
                </FieldContent>
              </Field>
              <Field data-invalid={!!errors.endTime || undefined}>
                <FieldLabel htmlFor="es-end">End</FieldLabel>
                <FieldContent>
                  <Input id="es-end" type="time" step={300} disabled={isPending} aria-invalid={!!errors.endTime} {...register("endTime")} />
                  <FieldError errors={[errors.endTime]} />
                </FieldContent>
              </Field>
              <Field className="col-span-2">
                <FieldLabel htmlFor="es-label">Or a time label</FieldLabel>
                <FieldContent>
                  <Input id="es-label" placeholder="Morning, After ceremony…" disabled={isPending} {...register("timeLabel")} />
                </FieldContent>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="es-location">Hall / location</FieldLabel>
                <FieldContent>
                  <Input id="es-location" placeholder="Hall 3" disabled={isPending} {...register("location")} />
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="es-priority">Priority</FieldLabel>
                <FieldContent>
                  <Select value={priority} items={PRIORITY_ITEMS} disabled={isPending} onValueChange={(v) => v && setPriority(v as SessionPriority)}>
                    <SelectTrigger id="es-priority" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SESSION_PRIORITY_ORDER.map((p) => (
                        <SelectItem key={p} value={p}>
                          {SESSION_PRIORITY_META[p].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="es-owner">
                <Crown aria-hidden className="mr-1 inline size-3.5 text-primary" />
                Owner
              </FieldLabel>
              <FieldContent>
                <Select value={ownerId} items={ownerItems} disabled={isPending} onValueChange={(v) => v && setOwnerId(v)}>
                  <SelectTrigger id="es-owner" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>No owner</SelectItem>
                    {candidates.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="es-focus">Camera focus</FieldLabel>
              <FieldContent>
                <Textarea id="es-focus" rows={3} placeholder="What must be captured…" disabled={isPending} {...register("focus")} />
              </FieldContent>
            </Field>

            {/* Crew */}
            <Field>
              <FieldLabel>Crew &amp; roles</FieldLabel>
              <FieldContent>
                <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
                  {crew.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-muted-foreground">No crew yet. Add people and give each a job.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {crew.map((c) => (
                        <li key={c.user.id} className="flex items-center gap-2">
                          <CrewAvatar user={c.user} owner={c.user.id === ownerId} />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.user.name}</span>
                          <Input
                            aria-label={`${c.user.name}'s role`}
                            placeholder="Role (Camera A, Drone…)"
                            className="h-7 w-40 text-xs"
                            defaultValue={c.role}
                            disabled={isPending}
                            onBlur={(e) => {
                              const role = e.currentTarget.value.trim();
                              setCrew((prev) => prev.map((x) => (x.user.id === c.user.id ? { ...x, role } : x)));
                              commitRole(c.user.id, role);
                            }}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${c.user.name}`}
                            disabled={isPending}
                            onClick={() => removeCrew(c.user.id)}
                          >
                            <X />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-col gap-2 border-t border-border pt-2 sm:flex-row">
                    <Combobox
                      items={pickItems}
                      value={pickUserId}
                      onValueChange={setPickUserId}
                      placeholder="Add a person…"
                      searchPlaceholder="Search people…"
                      emptyText="No one matches."
                      disabled={isPending}
                      triggerClassName="h-8 flex-1"
                    />
                    <Input
                      aria-label="Role for the new crew member"
                      placeholder="Role"
                      className="h-8 sm:w-36"
                      value={pickRole}
                      disabled={isPending}
                      onChange={(e) => setPickRole(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCrew();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" size="sm" className="h-8" disabled={!pickUserId || isPending} onClick={addCrew}>
                      <UserPlus />
                      Add
                    </Button>
                  </div>
                </div>
              </FieldContent>
            </Field>
          </FieldGroup>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : editing ? "Save changes" : "Add session"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
