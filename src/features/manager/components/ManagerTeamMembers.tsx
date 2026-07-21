"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Users, X } from "lucide-react";
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
import { addTeamMember, removeTeamMember } from "@/features/admin/actions";
import { Combobox } from "@/features/admin/components/Combobox";
import { initials } from "@/features/admin/components/display";
import type {
  ManagerAssignableUser,
  ManagerTeam,
  ManagerTeamMember,
} from "@/features/manager/queries";

/**
 * The delegation deferred from Phase B: a manager adds/removes members on
 * their OWN team(s) without needing global Admin / `/admin` access (that
 * area is Admin-only at the proxy layer). This is a thin convenience UI —
 * every mutation goes through the EXISTING `addTeamMember`/`removeTeamMember`
 * Server Actions, which already authorise via `requireTeamManage` (Admin OR
 * the team's own manager) on the server; nothing new is trusted here.
 * Interaction pattern mirrors `TeamDetailEditor`'s MembersSection (Combobox
 * add + list + remove-confirm dialog, router.refresh() + toast on failure),
 * just rendered per-team since a manager may oversee more than one team.
 */
export function ManagerTeamMembers({
  teams,
  users,
}: {
  teams: ManagerTeam[];
  users: ManagerAssignableUser[];
}) {
  if (teams.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        You don&apos;t manage any teams yet.
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {teams.map((team) => (
        <TeamCard key={team.id} team={team} users={users} />
      ))}
    </div>
  );
}

function TeamCard({ team, users }: { team: ManagerTeam; users: ManagerAssignableUser[] }) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [addUserId, setAddUserId] = React.useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<ManagerTeamMember | null>(null);

  const memberIds = new Set(team.members.map((m) => m.userId));
  const available = users.filter((u) => !memberIds.has(u.id));

  function onAdd() {
    if (!addUserId) return;
    startTransition(async () => {
      const res = await addTeamMember({ teamId: team.id, userId: addUserId });
      if (res.ok) {
        toast.success("Member added");
        setAddUserId(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function onRemove() {
    if (!removeTarget) return;
    const userId = removeTarget.userId;
    startTransition(async () => {
      const res = await removeTeamMember({ teamId: team.id, userId });
      if (res.ok) {
        toast.success("Member removed");
        setRemoveTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="glass flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <Users aria-hidden className="text-muted-foreground size-4 shrink-0" />
        <h3 className="text-foreground truncate text-sm font-semibold">{team.name}</h3>
        <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
          {team.members.length} member{team.members.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="border-border flex flex-col gap-2 rounded-lg border p-2.5 sm:flex-row sm:items-center">
        <Combobox
          items={available.map((u) => ({
            value: u.id,
            label: u.name,
            hint: `@${u.username}`,
          }))}
          value={addUserId}
          onValueChange={setAddUserId}
          placeholder={available.length ? "Select a user" : "No users to add"}
          searchPlaceholder="Search users…"
          emptyText="No users found."
          disabled={isPending || available.length === 0}
          triggerClassName="w-full sm:flex-1"
        />
        <Button
          type="button"
          size="sm"
          onClick={onAdd}
          disabled={isPending || !addUserId}
          className="sm:shrink-0"
        >
          <Plus />
          Add member
        </Button>
      </div>

      {team.members.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          No members yet. Add someone above.
        </p>
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {team.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2.5 py-1.5">
              <Avatar size="sm">
                <AvatarFallback className="text-[10px]">{initials(m.name)}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-foreground truncate text-sm font-medium">{m.name}</span>
                <span className="text-muted-foreground truncate font-mono text-xs">
                  @{m.username}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-danger shrink-0"
                aria-label={`Remove ${m.name} from ${team.name}`}
                disabled={isPending}
                onClick={() => setTimeout(() => setRemoveTarget(m), 0)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{removeTarget?.name}</strong> will lose any
              access {team.name} grants. You can add them again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isPending} onClick={onRemove}>
              {isPending ? "Removing…" : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
