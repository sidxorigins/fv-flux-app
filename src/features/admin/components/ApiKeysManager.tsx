"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Plus } from "lucide-react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { createApiKey, revokeApiKey } from "../api-keys/actions";
import type { ApiKeyRow } from "../api-keys/queries";
import type { AssignableUser } from "../queries";
import { CopyButton } from "./CopyButton";

// Fixed-timeZone formatter: the values are absolute dates, and pinning the
// timezone (rather than relying on the runtime default) keeps the server-
// rendered HTML and the client hydration pass byte-identical.
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatDate(value: Date | null): string {
  return value ? dateFmt.format(value) : "—";
}

const createApiKeyFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
});
type CreateApiKeyFormValues = z.infer<typeof createApiKeyFormSchema>;

/**
 * Admin-only API key management: create (show-once reveal), list, and revoke.
 * Keys let an external agent call `/api/v1` as a chosen user (global scope) —
 * see the page copy. Mirrors CreateUserDialog's dialog/form/Select idioms.
 */
export function ApiKeysManager({
  keys,
  users,
}: {
  keys: ApiKeyRow[];
  users: AssignableUser[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [actorUserId, setActorUserId] = React.useState<string>(
    () => users[0]?.id ?? "",
  );
  const [formError, setFormError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ key: string } | null>(null);

  const [revokeTarget, setRevokeTarget] = React.useState<ApiKeyRow | null>(null);
  const [isRevoking, startRevoking] = React.useTransition();

  const userItems = React.useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, `${u.name} (@${u.username})`])),
    [users],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateApiKeyFormValues>({
    resolver: zodResolver(createApiKeyFormSchema),
    defaultValues: { name: "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset state after the close animation so it doesn't flash empty.
      setTimeout(() => {
        reset();
        setActorUserId(users[0]?.id ?? "");
        setFormError(null);
        setResult(null);
      }, 150);
    }
  }

  const onSubmit = (values: CreateApiKeyFormValues) => {
    setFormError(null);
    if (!actorUserId) {
      setFormError("Select a user.");
      return;
    }
    startTransition(async () => {
      const res = await createApiKey({ name: values.name, userId: actorUserId });
      if (res.ok && res.data) {
        setResult({ key: res.data.key });
        toast.success("API key created");
        router.refresh();
      } else if (!res.ok) {
        setFormError(res.error);
      }
    });
  };

  function onRevoke() {
    if (!revokeTarget) return;
    const id = revokeTarget.id;
    startRevoking(async () => {
      const res = await revokeApiKey(id);
      if (res.ok) {
        toast.success("API key revoked");
        setRevokeTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger render={<Button size="sm" />}>
            <Plus />
            Create key
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Mints a key an external agent can use to call the API as the
                chosen user.
              </DialogDescription>
            </DialogHeader>

            {result ? (
              <>
                <div className="flex flex-col gap-3">
                  <p className="flex items-center gap-1.5 text-xs text-warning">
                    <KeyRound aria-hidden className="size-3.5" />
                    You won&rsquo;t see this key again — copy it now.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      API key
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-raised px-3 py-2 font-mono text-xs text-foreground">
                        {result.key}
                      </code>
                      <CopyButton value={result.key} label="Copy key" />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
                </DialogFooter>
              </>
            ) : (
              <form
                onSubmit={handleSubmit(onSubmit)}
                noValidate
                className="flex flex-col gap-4"
              >
                <FieldGroup>
                  <Field data-invalid={!!errors.name || undefined}>
                    <FieldLabel htmlFor="ak-name">Name</FieldLabel>
                    <FieldContent>
                      <Input
                        id="ak-name"
                        autoComplete="off"
                        placeholder="e.g. Zapier integration"
                        aria-invalid={!!errors.name}
                        disabled={isPending}
                        {...register("name")}
                      />
                      <FieldError errors={[errors.name]} />
                    </FieldContent>
                  </Field>

                  <Field orientation="responsive">
                    <FieldLabel htmlFor="ak-user">Acting as</FieldLabel>
                    <FieldContent>
                      <Select
                        value={actorUserId}
                        items={userItems}
                        disabled={isPending || users.length === 0}
                        onValueChange={(v) => v && setActorUserId(v)}
                      >
                        <SelectTrigger id="ak-user" className="w-full" aria-label="Acting as">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} (@{u.username})
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
                  <Button type="submit" disabled={isPending || users.length === 0}>
                    {isPending ? "Creating…" : "Create key"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {keys.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          No API keys yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Acting as</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => {
                const revoked = !!k.revokedAt;
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium text-foreground">{k.name}</TableCell>
                    <TableCell>
                      <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {k.prefix}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{k.actorName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(k.lastUsedAt)}
                    </TableCell>
                    <TableCell>
                      {revoked ? (
                        <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md bg-muted-foreground/10 px-1.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
                          <span
                            className="size-1.5 shrink-0 rounded-full bg-muted-foreground"
                            aria-hidden
                          />
                          Revoked
                        </span>
                      ) : (
                        <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md bg-success/10 px-1.5 text-[11px] font-medium whitespace-nowrap text-success">
                          <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                          Active
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {revoked ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-danger"
                          disabled={isRevoking && revokeTarget?.id === k.id}
                          onClick={() => setRevokeTarget(k)}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{revokeTarget?.name}</strong> will
              stop working immediately. Any integration using it will fail until a
              new key is issued.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isRevoking}
              onClick={onRevoke}
            >
              {isRevoking ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
