"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Shield, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { GlobalRole } from "@/generated/prisma/enums";

import { changeGlobalRole, setUserStatus } from "../actions";
import type { AdminUserRow } from "../queries";
import {
  GLOBAL_ROLE_LABELS,
  GLOBAL_ROLE_OPTIONS,
  GlobalRoleBadge,
  UserStatusBadge,
  initials,
} from "./display";

interface UsersTableProps {
  users: AdminUserRow[];
  /** The signed-in admin's id — used to guard self-targeting actions in the UI. */
  currentUserId: string;
}

type PendingAction =
  | { type: "suspend" | "reactivate"; user: AdminUserRow }
  | { type: "role"; user: AdminUserRow };

export function UsersTable({ users, currentUserId }: UsersTableProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState<PendingAction | null>(null);

  // Defer opening a dialog until after the dropdown has closed, so focus
  // handoff doesn't immediately dismiss the dialog.
  function openAction(action: PendingAction) {
    setTimeout(() => setPending(action), 10);
  }

  const statusAction =
    pending?.type === "suspend" || pending?.type === "reactivate" ? pending : null;
  const roleAction = pending?.type === "role" ? pending : null;

  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        No users match your search.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Projects</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="flex items-center gap-2.5 outline-none hover:underline focus-visible:underline"
                  >
                    <Avatar size="sm">
                      <AvatarFallback className="text-[10px]">
                        {initials(u.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-medium text-foreground">{u.name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        @{u.username}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <UserStatusBadge status={u.status} />
                </TableCell>
                <TableCell>
                  <GlobalRoleBadge role={u.globalRole} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {u.membershipCount}
                </TableCell>
                <TableCell className="text-muted-foreground">{u.createdAtLabel}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-sm" />}
                      aria-label={`Actions for ${u.name}`}
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem render={<Link href={`/admin/users/${u.id}`} />}>
                        View detail
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openAction({ type: "role", user: u })}>
                        <Shield />
                        Change role
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {u.status === "SUSPENDED" ? (
                        <DropdownMenuItem
                          onClick={() => openAction({ type: "reactivate", user: u })}
                        >
                          <UserCheck />
                          Reactivate
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={u.id === currentUserId || u.status !== "ACTIVE"}
                          onClick={() => openAction({ type: "suspend", user: u })}
                        >
                          <UserX />
                          Suspend
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <StatusConfirmDialog
        action={statusAction}
        onDone={() => setPending(null)}
        onSuccess={() => router.refresh()}
      />
      <ChangeRoleDialog
        action={roleAction}
        onDone={() => setPending(null)}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}

function StatusConfirmDialog({
  action,
  onDone,
  onSuccess,
}: {
  action: { type: "suspend" | "reactivate"; user: AdminUserRow } | null;
  onDone: () => void;
  onSuccess: () => void;
}) {
  const [isPending, startTransition] = React.useTransition();
  const suspend = action?.type === "suspend";

  function confirm() {
    if (!action) return;
    startTransition(async () => {
      const res = await setUserStatus({
        userId: action.user.id,
        status: suspend ? "SUSPENDED" : "ACTIVE",
      });
      if (res.ok) {
        toast.success(suspend ? "User suspended" : "User reactivated");
        onSuccess();
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <AlertDialog open={!!action} onOpenChange={(o) => !o && onDone()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {suspend ? "Suspend user?" : "Reactivate user?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {suspend ? (
              <>
                <strong className="text-foreground">{action?.user.name}</strong> will
                lose access immediately, even if currently signed in. You can
                reactivate them later.
              </>
            ) : (
              <>
                <strong className="text-foreground">{action?.user.name}</strong> will be
                able to sign in and access their projects again.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={suspend ? "destructive" : "default"}
            disabled={isPending}
            onClick={confirm}
          >
            {isPending ? "Working…" : suspend ? "Suspend" : "Reactivate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ChangeRoleDialog({
  action,
  onDone,
  onSuccess,
}: {
  action: { type: "role"; user: AdminUserRow } | null;
  onDone: () => void;
  onSuccess: () => void;
}) {
  const [isPending, startTransition] = React.useTransition();
  const [role, setRole] = React.useState<GlobalRole>(action?.user.globalRole ?? "USER");
  const [syncedId, setSyncedId] = React.useState<string | null>(action?.user.id ?? null);

  // Reset the picker to the target's current role when a new user is selected —
  // adjusting state during render (guarded), the idiomatic alternative to a
  // state-syncing effect.
  const actionId = action?.user.id ?? null;
  if (actionId !== syncedId) {
    setSyncedId(actionId);
    setRole(action?.user.globalRole ?? "USER");
  }

  function confirm() {
    if (!action) return;
    startTransition(async () => {
      const res = await changeGlobalRole({ userId: action.user.id, role });
      if (res.ok) {
        toast.success("Role updated");
        onSuccess();
        onDone();
      } else {
        toast.error(res.error);
      }
    });
  }

  const unchanged = action ? role === action.user.globalRole : true;

  return (
    <Dialog open={!!action} onOpenChange={(o) => !o && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change global role</DialogTitle>
          <DialogDescription>
            Set the platform-wide role for{" "}
            <strong className="text-foreground">{action?.user.name}</strong>. Admins
            can reach the admin area and manage all users and projects.
          </DialogDescription>
        </DialogHeader>

        <Select
          value={role}
          items={GLOBAL_ROLE_LABELS}
          disabled={isPending}
          onValueChange={(v) => v && setRole(v as GlobalRole)}
        >
          <SelectTrigger className="w-full" aria-label="Global role">
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

        <DialogFooter>
          <Button variant="outline" type="button" onClick={onDone} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={isPending || unchanged}>
            {isPending ? "Saving…" : "Save role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
