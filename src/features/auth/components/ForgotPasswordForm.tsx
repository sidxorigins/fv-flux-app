"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  requestPasswordResetSchema,
  type RequestPasswordResetInput,
} from "@/features/auth/schemas";
import { requestPasswordReset } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RequestPasswordResetInput>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = (values: RequestPasswordResetInput) => {
    setFormError(null);
    startTransition(async () => {
      const result = await requestPasswordReset(values);
      if (result.ok) {
        setSubmitted(true);
      } else {
        setFormError(result.error);
      }
    });
  };

  // Deliberately says nothing about whether the address is registered.
  if (submitted) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Check your email
          </h1>
          <p className="text-sm text-muted-foreground">
            If that address belongs to a Flux account, we&apos;ve sent a link to
            reset the password. It works once and expires in an hour.
          </p>
        </div>
        <Link
          href="/login"
          className="text-sm font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Forgot your password?
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a link to set a new one.
        </p>
      </div>

      <FieldGroup>
        <Field data-invalid={!!errors.email || undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <FieldContent>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              aria-invalid={!!errors.email}
              disabled={isPending}
              {...register("email")}
            />
            <FieldError errors={[errors.email]} />
          </FieldContent>
        </Field>
      </FieldGroup>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Sending…" : "Send reset link"}
      </Button>

      <Link
        href="/login"
        className="text-center text-sm text-muted-foreground hover:text-foreground"
      >
        Back to sign in
      </Link>
    </form>
  );
}
