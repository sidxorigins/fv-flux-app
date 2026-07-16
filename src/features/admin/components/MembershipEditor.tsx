"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X } from "lucide-react";
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
import type { AdminUserMembership } from "../queries";
import { Combobox } from "./Combobox";
import { ProjectRoleSelect } from "./ProjectRoleSelect";

interface ProjectOption {
  id: string;
  key: string;
  name: string;
}

interface MembershipEditorProps {
  userId: string;
  userName: string;
  memberships: AdminUserMembership[];
  projects: ProjectOption[];
}

/**
 * The "give role-based access" screen (user pivot): grant the user access to a
 * project at a role, change a role inline, or remove access. Every mutation is
 * server-authorised and refreshes the route on success.
 */
export function MembershipEditor({
  userId,
  userName,
  memberships,
  projects,
}: MembershipEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [addProjectId, setAddProjectId] = React.useState<string | null>(null);
  const [addRole, setAddRole] = React.useState<ProjectRole>("MEMBER");
  const [removeTarget, setRemoveTarget] = React.useState<AdminUserMembership | null>(null);

  const memberProjectIds = new Set(memberships.map((m) => m.projectId));
  const available = projects.filter((p) => !memberProjectIds.has(p.id));

  function onAdd() {
    if (!addProjectId) return;
    startTransition(async () => {
      const res = await addProjectMember({
        projectId: addProjectId,
        userId,
        projectRole: addRole,
      });
      if (res.ok) {
        toast.success("Access granted");
        setAddProjectId(null);
        setAddRole("MEMBER");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function onChangeRole(projectId: string, role: ProjectRole) {
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
    const projectId = removeTarget.projectId;
    startTransition(async () => {
      const res = await removeProjectMember({ projectId, userId });
      if (res.ok) {
        toast.success("Access removed");
        setRemoveTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Add-to-project row */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center">
        <Combobox
          items={available.map((p) => ({ value: p.id, label: p.name, hint: p.key }))}
          value={addProjectId}
          onValueChange={setAddProjectId}
          placeholder={available.length ? "Select a project" : "No more projects"}
          searchPlaceholder="Search projects…"
          emptyText="No projects found."
          disabled={isPending || available.length === 0}
          triggerClassName="w-full sm:w-64"
        />
        <ProjectRoleSelect
          value={addRole}
          onValueChange={setAddRole}
          disabled={isPending}
          size="default"
          aria-label="Role for the new project"
        />
        <Button
          type="button"
          size="sm"
          onClick={onAdd}
          disabled={isPending || !addProjectId}
          className="sm:ml-auto"
        >
          <Plus />
          Add to project
        </Button>
      </div>

      {/* Current memberships */}
      {memberships.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          {userName} doesn&apos;t have access to any projects yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Project</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberships.map((m) => (
                <TableRow key={m.projectId}>
                  <TableCell>
                    <Link
                      href={`/admin/projects/${m.projectId}`}
                      className="flex items-center gap-2 outline-none hover:underline focus-visible:underline"
                    >
                      <span className="rounded-sm bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {m.projectKey}
                      </span>
                      <span className="font-medium text-foreground">{m.projectName}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ProjectRoleSelect
                      value={m.projectRole}
                      onValueChange={(role) => onChangeRole(m.projectId, role)}
                      disabled={isPending}
                      aria-label={`Role in ${m.projectName}`}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.grantedAtLabel}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-danger"
                      aria-label={`Remove access to ${m.projectName}`}
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
            <AlertDialogTitle>Remove access?</AlertDialogTitle>
            <AlertDialogDescription>
              {userName} will lose access to{" "}
              <strong className="text-foreground">{removeTarget?.projectName}</strong>.
              You can grant it again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isPending} onClick={onRemove}>
              {isPending ? "Removing…" : "Remove access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
