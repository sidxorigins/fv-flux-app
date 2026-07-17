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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GlobalRole, ProjectRole } from "@/generated/prisma/enums";

import { createUser } from "../actions";
import { GLOBAL_ROLE_LABELS, GLOBAL_ROLE_OPTIONS } from "./display";
import { InviteResult } from "./InviteResult";

const PROJECT_ROLE_ORDER = ["MANAGER", "MEMBER", "VIEWER"] as const;
const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = {
  MANAGER: "Manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export interface CreateUserDialogProject {
  id: string;
  key: string;
  name: string;
}

const createUserFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  email: emailSchema,
  username: usernameSchema,
});

type CreateUserFormValues = z.infer<typeof createUserFormSchema>;

export function CreateUserDialog({
  projects = [],
}: {
  /** Projects the admin can grant the new user access to at creation. */
  projects?: CreateUserDialogProject[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [role, setRole] = React.useState<GlobalRole>("USER");
  // Per-project access to grant on creation: projectId → role (absent = no access).
  const [grants, setGrants] = React.useState<Map<string, ProjectRole>>(
    () => new Map(),
  );
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
        setGrants(new Map());
        setFormError(null);
        setResult(null);
      }, 150);
    }
  }

  function toggleProject(projectId: string) {
    setGrants((prev) => {
      const next = new Map(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.set(projectId, "MEMBER"); // sensible default
      return next;
    });
  }

  function setGrantRole(projectId: string, role: ProjectRole) {
    setGrants((prev) => new Map(prev).set(projectId, role));
  }

  const onSubmit = (values: CreateUserFormValues) => {
    setFormError(null);
    startTransition(async () => {
      const res = await createUser({
        ...values,
        intendedGlobalRole: role,
        mode: "invite-link",
        projectGrants: [...grants.entries()].map(([projectId, projectRole]) => ({
          projectId,
          projectRole,
        })),
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

              {projects.length > 0 ? (
                <Field>
                  <FieldLabel>Project access</FieldLabel>
                  <FieldContent>
                    <FieldDescription>
                      Grant access now so the user lands on a project at first
                      login. Optional — you can add access later.
                    </FieldDescription>
                    <div className="flex max-h-52 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1.5">
                      {projects.map((project) => {
                        const selected = grants.has(project.id);
                        return (
                          <div
                            key={project.id}
                            className="flex items-center gap-2 rounded-md px-1.5 py-1"
                          >
                            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-foreground">
                              <Checkbox
                                checked={selected}
                                onCheckedChange={() => toggleProject(project.id)}
                                disabled={isPending}
                                aria-label={`Grant access to ${project.name}`}
                              />
                              <span className="rounded bg-surface-raised px-1 py-0.5 font-mono text-xs text-muted-foreground">
                                {project.key}
                              </span>
                              <span className="truncate">{project.name}</span>
                            </label>
                            {selected ? (
                              <Select
                                value={grants.get(project.id) ?? "MEMBER"}
                                disabled={isPending}
                                onValueChange={(v) =>
                                  v && setGrantRole(project.id, v as ProjectRole)
                                }
                              >
                                <SelectTrigger
                                  className="h-7 w-28 shrink-0"
                                  aria-label={`Role for ${project.name}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PROJECT_ROLE_ORDER.map((r) => (
                                    <SelectItem key={r} value={r}>
                                      {PROJECT_ROLE_LABEL[r]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </FieldContent>
                </Field>
              ) : null}
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
