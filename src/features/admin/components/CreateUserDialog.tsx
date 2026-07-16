"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

import { emailSchema, usernameSchema } from "@/features/auth/schemas";
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GlobalRole } from "@/generated/prisma/enums";

import { createUser } from "../actions";
import { GLOBAL_ROLE_LABELS, GLOBAL_ROLE_OPTIONS } from "./display";
import { InviteResult } from "./InviteResult";

const createUserFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  email: emailSchema,
  username: usernameSchema,
});

type CreateUserFormValues = z.infer<typeof createUserFormSchema>;

export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [role, setRole] = React.useState<GlobalRole>("USER");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{
    inviteUrl: string;
    emailSent: boolean;
  } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserFormSchema),
    defaultValues: { name: "", email: "", username: "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset state after the close animation so it doesn't flash empty.
      setTimeout(() => {
        reset();
        setRole("USER");
        setFormError(null);
        setResult(null);
      }, 150);
    }
  }

  const onSubmit = (values: CreateUserFormValues) => {
    setFormError(null);
    startTransition(async () => {
      const res = await createUser({
        ...values,
        intendedGlobalRole: role,
        mode: "invite-link",
      });
      if (res.ok && res.data) {
        setResult({ inviteUrl: res.data.inviteUrl, emailSent: res.data.emailSent });
        toast.success("User created");
        router.refresh();
      } else if (!res.ok) {
        setFormError(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlus />
        Create user
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            Creates the account and generates a set-password link. No temporary
            password is issued — the user sets their own via the link.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <InviteResult
              inviteUrl={result.inviteUrl}
              emailSent={result.emailSent}
              title="User created"
            />
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <FieldGroup>
              <Field data-invalid={!!errors.name || undefined}>
                <FieldLabel htmlFor="cu-name">Name</FieldLabel>
                <FieldContent>
                  <Input
                    id="cu-name"
                    autoComplete="off"
                    aria-invalid={!!errors.name}
                    disabled={isPending}
                    {...register("name")}
                  />
                  <FieldError errors={[errors.name]} />
                </FieldContent>
              </Field>

              <Field data-invalid={!!errors.email || undefined}>
                <FieldLabel htmlFor="cu-email">Email</FieldLabel>
                <FieldContent>
                  <Input
                    id="cu-email"
                    type="email"
                    autoComplete="off"
                    aria-invalid={!!errors.email}
                    disabled={isPending}
                    {...register("email")}
                  />
                  <FieldError errors={[errors.email]} />
                </FieldContent>
              </Field>

              <Field data-invalid={!!errors.username || undefined}>
                <FieldLabel htmlFor="cu-username">Username</FieldLabel>
                <FieldContent>
                  <Input
                    id="cu-username"
                    autoComplete="off"
                    aria-invalid={!!errors.username}
                    disabled={isPending}
                    {...register("username", {
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                        e.target.value = e.target.value.toLowerCase();
                      },
                    })}
                  />
                  <FieldDescription>
                    Lowercase letters, numbers, and underscores.
                  </FieldDescription>
                  <FieldError errors={[errors.username]} />
                </FieldContent>
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="cu-role">Global role</FieldLabel>
                <FieldContent>
                  <Select
                    value={role}
                    items={GLOBAL_ROLE_LABELS}
                    disabled={isPending}
                    onValueChange={(v) => v && setRole(v as GlobalRole)}
                  >
                    <SelectTrigger id="cu-role" className="w-full" aria-label="Global role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GLOBAL_ROLE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                {isPending ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
