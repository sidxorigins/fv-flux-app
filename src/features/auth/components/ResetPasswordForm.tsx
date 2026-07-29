"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { setPasswordSchema, type SetPasswordInput } from "@/features/auth/schemas";
import { resetPassword } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { token, password: "" },
  });

  const onSubmit = (values: SetPasswordInput) => {
    setFormError(null);
    startTransition(async () => {
      const result = await resetPassword(values);
      if (result.ok) {
        setDone(true);
        router.refresh();
      } else {
        setFormError(result.error);
      }
    });
  };

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Password updated
          </h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ve been signed out everywhere else. Sign in with your new
            password to continue.
          </p>
        </div>
        <Button render={<Link href="/login" />} className="w-full">
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Choose a new password
        </h1>
        <p className="text-sm text-muted-foreground">
          At least 10 characters, with a letter and a number.
        </p>
      </div>

      <input type="hidden" {...register("token")} />

      <FieldGroup>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <FieldContent>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              disabled={isPending}
              {...register("password")}
            />
            <FieldError errors={[errors.password]} />
          </FieldContent>
        </Field>
      </FieldGroup>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
