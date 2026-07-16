"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { z } from "zod";

import {
  registerSchema,
  usernameSchema,
  passwordSchema,
} from "@/features/auth/schemas";
import { registerWithInvite } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

/**
 * Client-only shape for this form. Reuses the exact field validators from
 * `registerSchema` / `usernameSchema` / `passwordSchema` (@/features/auth/schemas)
 * so client-side feedback never drifts from what the server actually
 * enforces, and adds one field that only exists here: `confirmPassword`
 * ("client-only refinement" — never sent to the server).
 */
const registerFormSchema = z
  .object({
    name: registerSchema.shape.name,
    username: usernameSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RegisterFormValues = z.infer<typeof registerFormSchema>;

interface RegisterFormProps {
  token: string;
  email: string;
}

export function RegisterForm({ token, email }: RegisterFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { name: "", username: "", password: "", confirmPassword: "" },
  });

  // Brief success state, then hand off to /login — no need to linger.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => {
      router.push("/login");
    }, 1200);
    return () => clearTimeout(timer);
  }, [success, router]);

  const onSubmit = (values: RegisterFormValues) => {
    setFormError(null);
    startTransition(async () => {
      const result = await registerWithInvite({
        token,
        name: values.name,
        username: values.username,
        password: values.password,
      });

      if (result.ok) {
        setSuccess(true);
      } else {
        setFormError(result.error);
      }
    });
  };

  if (success) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 py-4 text-center transition-opacity duration-200 motion-reduce:transition-none"
      >
        <CheckCircle2 aria-hidden className="size-8 text-success" />
        <p className="text-sm font-medium text-foreground">Account created</p>
        <p className="text-sm text-muted-foreground">Taking you to sign in…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <Field>
        <FieldLabel htmlFor="invite-email">Email</FieldLabel>
        <FieldContent>
          <Input
            id="invite-email"
            type="email"
            value={email}
            readOnly
            disabled
            aria-readonly="true"
          />
          <FieldDescription>From your invite — this can&apos;t be changed here.</FieldDescription>
        </FieldContent>
      </Field>

      <FieldGroup>
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              aria-invalid={!!errors.name}
              disabled={isPending}
              {...register("name")}
            />
            <FieldError errors={[errors.name]} />
          </FieldContent>
        </Field>

        <Field data-invalid={!!errors.username || undefined}>
          <FieldLabel htmlFor="username">Username</FieldLabel>
          <FieldContent>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              aria-invalid={!!errors.username}
              disabled={isPending}
              {...register("username", {
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  // Live-lowercase as the user types.
                  event.target.value = event.target.value.toLowerCase();
                },
              })}
            />
            <FieldDescription>
              Lowercase letters, numbers, and underscores — this becomes your handle.
            </FieldDescription>
            <FieldError errors={[errors.username]} />
          </FieldContent>
        </Field>

        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <FieldContent>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              disabled={isPending}
              {...register("password")}
            />
            <FieldDescription>At least 10 characters, with a letter and a number.</FieldDescription>
            <FieldError errors={[errors.password]} />
          </FieldContent>
        </Field>

        <Field data-invalid={!!errors.confirmPassword || undefined}>
          <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
          <FieldContent>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              disabled={isPending}
              {...register("confirmPassword")}
            />
            <FieldError errors={[errors.confirmPassword]} />
          </FieldContent>
        </Field>
      </FieldGroup>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
