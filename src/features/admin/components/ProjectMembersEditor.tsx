"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectRole } from "@/generated/prisma/enums";

import {
  addProjectMember,
  removeProjectMember,
  updateProjectMember,
} from "../actions";
import type { AdminProjectMember, AssignableUser } from "../queries";
import { Combobox } from "./Combobox";
import { ProjectRoleSelect } from "./ProjectRoleSelect";
import { UserStatusBadge, initials } from "./display";

interface ProjectMembersEditorProps {
  projectId: string;
  projectName: string;
  members: AdminProjectMember[];
  users: AssignableUser[];
}

/**
 * The "give role-based access" screen (project pivot): add a user to this
 * project at a role, change roles inline, or remove members. Same interaction
 * pattern as the user-detail editor, opposite pivot.
 */
export function ProjectMembersEditor({
  projectId,
  projectName,
  members,
  users,
}: ProjectMembersEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [addUserId, setAddUserId] = React.useState<string | null>(null);
  const [addRole, setAddRole] = React.useState<ProjectRole>("MEMBER");
  const [removeTarget, setRemoveTarget] = React.useState<AdminProjectMember | null>(null);

  const memberIds = new Set(members.map((m) => m.userId));
  const available = users.filter((u) => !memberIds.has(u.id));

  function onAdd() {
    if (!addUserId) return;
    startTransition(async () => {
      const res = await addProjectMember({
        projectId,
        userId: addUserId,
        projectRole: addRole,
      });
      if (res.ok) {
        toast.success("Member added");
        setAddUserId(null);
        setAddRole("MEMBER");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function onChangeRole(userId: string, role: ProjectRole) {
    startTransition(async () => {
      const res = await updateProjectMember({ projectId, userId, projectRole: role });
      if (res.ok) {
        toast.success("Role updated");
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
      const res = await removeProjectMember({ projectId, userId });
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center">
        <Combobox
          items={available.map((u) => ({ value: u.id, label: u.name, hint: u.email }))}
          value={addUserId}
          onValueChange={setAddUserId}
          placeholder={available.length ? "Select a user" : "No users to add"}
          searchPlaceholder="Search users…"
          emptyText="No users found."
          disabled={isPending || available.length === 0}
          triggerClassName="w-full sm:w-64"
        />
        <ProjectRoleSelect
          value={addRole}
          onValueChange={setAddRole}
          disabled={isPending}
          size="default"
          aria-label="Role for the new member"
        />
        <Button
          type="button"
          size="sm"
          onClick={onAdd}
          disabled={isPending || !addUserId}
          className="sm:ml-auto"
        >
          <Plus />
          Add member
        </Button>
      </div>

      {members.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          No members yet. Add someone above to grant access.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    <Link
                      href={`/admin/users/${m.userId}`}
                      className="flex items-center gap-2.5 outline-none hover:underline focus-visible:underline"
                    >
                      <Avatar size="sm">
                        <AvatarFallback className="text-[10px]">
                          {initials(m.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate font-medium text-foreground">{m.name}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          @{m.username}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <UserStatusBadge status={m.status} />
                  </TableCell>
                  <TableCell>
                    <ProjectRoleSelect
                      value={m.projectRole}
                      onValueChange={(role) => onChangeRole(m.userId, role)}
                      disabled={isPending}
                      aria-label={`Role for ${m.name}`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.grantedAtLabel}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-danger"
                      aria-label={`Remove ${m.name}`}
                      disabled={isPending}
                      onClick={() => setTimeout(() => setRemoveTarget(m), 0)}
                    >
                      <X />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{removeTarget?.name}</strong> will lose
              access to {projectName}. You can add them again at any time.
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
