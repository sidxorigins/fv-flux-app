"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Users } from "lucide-react";
import { toast } from "sonner";

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
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { createTeam } from "../actions";
import { createTeamSchema, type CreateTeamInput } from "../schemas";

type CreateTeamFormValues = CreateTeamInput;

/** "New team" dialog on `/admin/teams` — creates the team, then jumps straight to its detail page to assign a manager/members. */
export function CreateTeamDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTeamFormValues>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { name: "", description: "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTimeout(() => {
        reset();
        setFormError(null);
      }, 150);
    }
  }

  const onSubmit = (values: CreateTeamFormValues) => {
    setFormError(null);
    startTransition(async () => {
      const res = await createTeam({
        name: values.name,
        description: values.description || undefined,
      });
      if (res.ok && res.data) {
        toast.success("Team created");
        setOpen(false);
        router.push(`/admin/teams/${res.data.teamId}`);
      } else if (!res.ok) {
        setFormError(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <Users />
        New team
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>
            Create a team, then assign a manager and members from its detail
            page.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="ct-name">Name</FieldLabel>
              <FieldContent>
                <Input
                  id="ct-name"
                  autoComplete="off"
                  aria-invalid={!!errors.name}
                  disabled={isPending}
                  {...register("name")}
                />
                <FieldError errors={[errors.name]} />
              </FieldContent>
            </Field>

            <Field data-invalid={!!errors.description || undefined}>
              <FieldLabel htmlFor="ct-description">Description</FieldLabel>
              <FieldContent>
                <Textarea
                  id="ct-description"
                  rows={3}
                  aria-invalid={!!errors.description}
                  disabled={isPending}
                  {...register("description")}
                />
                <FieldError errors={[errors.description]} />
              </FieldContent>
            </Field>
          </FieldGroup>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
