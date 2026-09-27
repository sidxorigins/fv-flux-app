"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Sparkles } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { createEvent, createEventFromTemplate } from "../actions";
import { eventSlug, isoDate } from "../schemas";

const formSchema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    slug: eventSlug,
    subtitle: z.string().trim().max(200),
    venue: z.string().trim().max(200),
    startDate: isoDate,
    endDate: isoDate,
    timezone: z.string().trim().min(1, "Time zone is required").max(64),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End must be on or after start", path: ["endDate"] });
type FormValues = z.infer<typeof formSchema>;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** Admin-only: create a blank event, or import the bundled Expogast 2026 run sheet. */
export function CreateEventDialog({ hasExpogast }: { hasExpogast: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [slugTouched, setSlugTouched] = React.useState(false);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", slug: "", subtitle: "", venue: "", startDate: "", endDate: "", timezone: "Asia/Dubai" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setTimeout(() => { reset(); setFormError(null); setSlugTouched(false); }, 150);
  }

  const onSubmit = (values: FormValues) => {
    setFormError(null);
    startTransition(async () => {
      const res = await createEvent(values);
      if (!res.ok || !res.data) { setFormError(res.ok ? "Something went wrong." : res.error); return; }
      toast.success("Event created");
      onOpenChange(false);
      router.push(`/events/${res.data.slug}`);
      router.refresh();
    });
  };

  function importExpogast() {
    startTransition(async () => {
      const res = await createEventFromTemplate("expogast-2026");
      if (!res.ok || !res.data) { toast.error(res.ok ? "Something went wrong." : res.error); return; }
      toast.success("Expogast 2026 imported — every day and session is now editable");
      router.push(`/events/${res.data.slug}`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {!hasExpogast ? (
        <Button variant="outline" size="sm" disabled={isPending} onClick={importExpogast}>
          <Sparkles /> Import Expogast 2026
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger render={<Button size="sm" />}>
          <Plus /> New event
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New event</DialogTitle>
            <DialogDescription>One empty day is created for every date in the range.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <FieldGroup>
              <Field data-invalid={!!errors.name || undefined}>
                <FieldLabel htmlFor="ne-name">Name</FieldLabel>
                <FieldContent>
                  <Input
                    id="ne-name"
                    autoComplete="off"
                    disabled={isPending}
                    aria-invalid={!!errors.name}
                    {...register("name", {
                      onChange: (e) => { if (!slugTouched) setValue("slug", slugify(e.target.value)); },
                    })}
                  />
                  <FieldError errors={[errors.name]} />
                </FieldContent>
              </Field>
              <Field data-invalid={!!errors.slug || undefined}>
                <FieldLabel htmlFor="ne-slug">URL handle</FieldLabel>
                <FieldContent>
                  <Input id="ne-slug" autoComplete="off" disabled={isPending} aria-invalid={!!errors.slug} {...register("slug", { onChange: () => setSlugTouched(true) })} />
                  <FieldDescription>flux.foodverse.io/events/&lt;handle&gt;</FieldDescription>
                  <FieldError errors={[errors.slug]} />
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor="ne-subtitle">Subtitle</FieldLabel>
                <FieldContent>
                  <Input id="ne-subtitle" disabled={isPending} {...register("subtitle")} />
                </FieldContent>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={!!errors.startDate || undefined}>
                  <FieldLabel htmlFor="ne-start">Start date</FieldLabel>
                  <FieldContent>
                    <Input id="ne-start" type="date" disabled={isPending} aria-invalid={!!errors.startDate} {...register("startDate")} />
                    <FieldError errors={[errors.startDate]} />
                  </FieldContent>
                </Field>
                <Field data-invalid={!!errors.endDate || undefined}>
                  <FieldLabel htmlFor="ne-end">End date</FieldLabel>
                  <FieldContent>
                    <Input id="ne-end" type="date" disabled={isPending} aria-invalid={!!errors.endDate} {...register("endDate")} />
                    <FieldError errors={[errors.endDate]} />
                  </FieldContent>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="ne-venue">Venue</FieldLabel>
                  <FieldContent>
                    <Input id="ne-venue" disabled={isPending} {...register("venue")} />
                  </FieldContent>
                </Field>
                <Field data-invalid={!!errors.timezone || undefined}>
                  <FieldLabel htmlFor="ne-tz">Time zone</FieldLabel>
                  <FieldContent>
                    <Input id="ne-tz" placeholder="Europe/Luxembourg" disabled={isPending} aria-invalid={!!errors.timezone} {...register("timezone")} />
                    <FieldError errors={[errors.timezone]} />
                  </FieldContent>
                </Field>
              </div>
            </FieldGroup>
            {formError ? <p role="alert" className="text-sm font-medium text-danger">{formError}</p> : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={isPending}>{isPending ? "Creating…" : "Create event"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
