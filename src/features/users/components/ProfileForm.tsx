"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";

import { usernameSchema } from "@/features/auth/schemas";
import { updateProfile } from "@/features/users/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

const BIO_MAX = 280;

/**
 * Client-only mirror of `updateProfileSchema` (@/features/users/schemas).
 * Deliberately NOT imported from there: that module also defines the
 * avatar-upload schemas, which pull in @/lib/r2 (AWS SDK + `node:crypto`) —
 * importing it here would drag server-only code into the client bundle.
 * `usernameSchema` has no server dependency, so it's reused directly; the
 * name/bio rules are duplicated and must stay in sync with
 * `updateProfileSchema`. The Server Action re-validates with the real schema
 * regardless of what the client sends, so this mirror only affects UX.
 */
const profileFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(80, "Name must be at most 80 characters"),
  username: usernameSchema,
  bio: z
    .string()
    .trim()
    .max(BIO_MAX, `Bio must be at most ${BIO_MAX} characters`)
    .optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

interface ProfileFormProps {
  defaultValues: {
    name: string;
    username: string;
    bio: string;
  };
}

export function ProfileForm({ defaultValues }: ProfileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues,
  });

  // `useWatch` (not the `watch()` returned by `useForm`) so the React
  // Compiler can safely memoize this component.
  const bioLength = (useWatch({ control, name: "bio" }) ?? "").length;

  const onSubmit = (values: ProfileFormValues) => {
    setFormError(null);
    startTransition(async () => {
      const result = await updateProfile({
        name: values.name,
        username: values.username,
        bio: values.bio,
      });

      if (result.ok) {
        toast.success("Profile updated");
        router.refresh();
        return;
      }

      // Username-taken comes back as a plain server message — surface it
      // against the field itself rather than as a generic banner.
      if (result.error.toLowerCase().includes("username")) {
        setError("username", { type: "server", message: result.error });
      } else {
        setFormError(result.error);
      }
      toast.error(result.error);
    });
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-col gap-6"
    >
      <FieldGroup>
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="profile-name">Name</FieldLabel>
          <FieldContent>
            <Input
              id="profile-name"
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
          <FieldLabel htmlFor="profile-username">Username</FieldLabel>
          <FieldContent>
            <Input
              id="profile-username"
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
              3–30 chars, lowercase letters, numbers, underscores.
            </FieldDescription>
            <FieldError errors={[errors.username]} />
          </FieldContent>
        </Field>

        <Field data-invalid={!!errors.bio || undefined}>
          <FieldLabel htmlFor="profile-bio">Bio</FieldLabel>
          <FieldContent>
            <Textarea
              id="profile-bio"
              rows={3}
              maxLength={BIO_MAX}
              aria-invalid={!!errors.bio}
              disabled={isPending}
              {...register("bio")}
            />
            <div className="flex items-center justify-between gap-2">
              <FieldError errors={[errors.bio]} />
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {bioLength}/{BIO_MAX}
              </span>
            </div>
          </FieldContent>
        </Field>
      </FieldGroup>

      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={isPending} className="min-w-32">
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
