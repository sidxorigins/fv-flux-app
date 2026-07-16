"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { emailSchema } from "@/features/auth/schemas";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GlobalRole } from "@/generated/prisma/enums";

import { sendInvite } from "../actions";
import { GLOBAL_ROLE_LABELS, GLOBAL_ROLE_OPTIONS } from "./display";
import { InviteResult } from "./InviteResult";

const sendInviteFormSchema = z.object({ email: emailSchema });
type SendInviteFormValues = z.infer<typeof sendInviteFormSchema>;

export function SendInviteDialog() {
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
  } = useForm<SendInviteFormValues>({
    resolver: zodResolver(sendInviteFormSchema),
    defaultValues: { email: "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTimeout(() => {
        reset();
        setRole("USER");
        setFormError(null);
        setResult(null);
      }, 150);
    }
  }

  const onSubmit = (values: SendInviteFormValues) => {
    setFormError(null);
    startTransition(async () => {
      const res = await sendInvite({ email: values.email, intendedGlobalRole: role });
      if (res.ok && res.data) {
        setResult({ inviteUrl: res.data.inviteUrl, emailSent: res.data.emailSent });
        toast.success(res.data.emailSent ? "Invite sent" : "Invite created");
        router.refresh();
      } else if (!res.ok) {
        setFormError(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <Send />
        Send invite
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send invite</DialogTitle>
          <DialogDescription>
            Emails a single-use registration link (valid 72 hours). The link is
            also shown here to copy and share directly.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <InviteResult
              inviteUrl={result.inviteUrl}
              emailSent={result.emailSent}
              title="Invite ready"
            />
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <FieldGroup>
              <Field data-invalid={!!errors.email || undefined}>
                <FieldLabel htmlFor="inv-email">Email</FieldLabel>
                <FieldContent>
                  <Input
                    id="inv-email"
                    type="email"
                    autoComplete="off"
                    aria-invalid={!!errors.email}
                    disabled={isPending}
                    {...register("email")}
                  />
                  <FieldError errors={[errors.email]} />
                </FieldContent>
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="inv-role">Global role</FieldLabel>
                <FieldContent>
                  <Select
                    value={role}
                    items={GLOBAL_ROLE_LABELS}
                    disabled={isPending}
                    onValueChange={(v) => v && setRole(v as GlobalRole)}
                  >
                    <SelectTrigger id="inv-role" className="w-full" aria-label="Global role">
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
                {isPending ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
