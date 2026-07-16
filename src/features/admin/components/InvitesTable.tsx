"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  DialogClose,
  DialogContent,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { resendInvite, revokeInvite } from "../actions";
import type { AdminInviteRow } from "../queries";
import { GlobalRoleBadge } from "./display";
import { InviteResult } from "./InviteResult";

function formatExpiry(expiresAtMs: number, nowMs: number): { text: string; expired: boolean } {
  const diff = expiresAtMs - nowMs;
  if (diff <= 0) return { text: "Expired", expired: true };
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 24) return { text: `Expires in ${Math.floor(hours / 24)}d`, expired: false };
  if (hours >= 1) return { text: `Expires in ${hours}h`, expired: false };
  return { text: `Expires in ${Math.max(1, Math.floor(diff / 60_000))}m`, expired: false };
}

// Stable per-page-load clock so useSyncExternalStore snapshots keep identity
// across renders (minute-level granularity is all the expiry copy needs). Server
// and hydration renders both see null → no mismatch; the value fills in on paint.
const emptySubscribe = () => () => {};
let clientNowMs: number | null = null;
const getClientNowMs = (): number | null => {
  if (clientNowMs === null) clientNowMs = Date.now();
  return clientNowMs;
};
const getServerNowMs = (): number | null => null;

/** Relative expiry, resolved client-side only to avoid a hydration mismatch. */
function ExpiryCell({ expiresAtMs }: { expiresAtMs: number }) {
  const now = React.useSyncExternalStore(emptySubscribe, getClientNowMs, getServerNowMs);
  if (now === null) return <span className="text-muted-foreground">—</span>;
  const { text, expired } = formatExpiry(expiresAtMs, now);
  return (
    <span className={cn("text-sm", expired ? "text-danger" : "text-muted-foreground")}>
      {text}
    </span>
  );
}

export function InvitesTable({ invites }: { invites: AdminInviteRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<AdminInviteRow | null>(null);
  const [resendResult, setResendResult] = React.useState<{
    email: string;
    inviteUrl: string;
    emailSent: boolean;
  } | null>(null);
  const [isPending, startTransition] = React.useTransition();

  function onCopyLink(invite: AdminInviteRow) {
    // The raw token is only available at generation time, so "copy link" mints a
    // fresh link via resend (invalidating the previous one) and copies it.
    setBusyId(invite.id);
    startTransition(async () => {
      const res = await resendInvite(invite.id);
      setBusyId(null);
      if (res.ok && res.data) {
        try {
          await navigator.clipboard.writeText(res.data.inviteUrl);
          toast.success("Copied — a fresh link was generated");
        } catch {
          setResendResult({
            email: invite.email,
            inviteUrl: res.data.inviteUrl,
            emailSent: res.data.emailSent,
          });
        }
        router.refresh();
      } else if (!res.ok) {
        toast.error(res.error);
      }
    });
  }

  function onResend(invite: AdminInviteRow) {
    setBusyId(invite.id);
    startTransition(async () => {
      const res = await resendInvite(invite.id);
      setBusyId(null);
      if (res.ok && res.data) {
        setResendResult({
          email: invite.email,
          inviteUrl: res.data.inviteUrl,
          emailSent: res.data.emailSent,
        });
        toast.success(res.data.emailSent ? "Invite resent" : "New link generated");
        router.refresh();
      } else if (!res.ok) {
        toast.error(res.error);
      }
    });
  }

  function onRevoke() {
    if (!revokeTarget) return;
    const id = revokeTarget.id;
    startTransition(async () => {
      const res = await revokeInvite(id);
      if (res.ok) {
        toast.success("Invite revoked");
        setRevokeTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (invites.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        No pending invites.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Email</TableHead>
              <TableHead>Intended role</TableHead>
              <TableHead>Invited by</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invites.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="font-medium text-foreground">{inv.email}</TableCell>
                <TableCell>
                  <GlobalRoleBadge role={inv.intendedGlobalRole} />
                </TableCell>
                <TableCell className="text-muted-foreground">{inv.invitedByName}</TableCell>
                <TableCell className="text-muted-foreground">{inv.createdAtLabel}</TableCell>
                <TableCell>
                  <ExpiryCell expiresAtMs={inv.expiresAtMs} />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-sm" />}
                      aria-label={`Actions for invite to ${inv.email}`}
                      disabled={isPending && busyId === inv.id}
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => onCopyLink(inv)}>
                        <Link2 />
                        Copy link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onResend(inv)}>
                        <RefreshCw />
                        Resend
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setTimeout(() => setRevokeTarget(inv), 10)}
                      >
                        <Trash2 />
                        Revoke
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invite?</AlertDialogTitle>
            <AlertDialogDescription>
              The link sent to{" "}
              <strong className="text-foreground">{revokeTarget?.email}</strong> will
              stop working immediately. You can send a new invite later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isPending} onClick={onRevoke}>
              {isPending ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!resendResult} onOpenChange={(o) => !o && setResendResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New invite link</DialogTitle>
          </DialogHeader>
          {resendResult ? (
            <InviteResult
              inviteUrl={resendResult.inviteUrl}
              emailSent={resendResult.emailSent}
            />
          ) : null}
          <div className="flex justify-end">
            <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
