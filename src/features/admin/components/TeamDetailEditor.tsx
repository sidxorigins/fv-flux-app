"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectRole } from "@/generated/prisma/enums";

import {
  addTeamMember,
  assignTeamManager,
  assignTeamProject,
  removeTeamMember,
  setTeamProductivityVisibility,
  unassignTeamProject,
  updateTeam,
  updateTeamProjectRole,
} from "../actions";
import type {
  AdminProjectRow,
  AdminTeamDetail,
  AdminTeamMember,
  AdminTeamProject,
  AssignableUser,
} from "../queries";
import { Combobox } from "./Combobox";
import { ProjectRoleSelect } from "./ProjectRoleSelect";
import { TeamStatusBadge, initials } from "./display";

interface TeamDetailEditorProps {
  team: AdminTeamDetail;
  users: AssignableUser[];
  projects: AdminProjectRow[];
  /**
   * True when the signed-in user is a global Admin. The page's guard already
   * ensures anyone rendering this component is admin-or-the-team's-manager
   * (see `canManageTeam` in the detail page), so member add/remove stays
   * available to both — this flag only gates the Admin-only controls (manager
   * assignment, details edit, and project assign/role/remove), matching the
   * server-side `requireAdmin()` checks those actions run.
   */
  canManageAsAdmin: boolean;
}

/**
 * The `/admin/teams/[teamId]` editor. Four sections: details, manager,
 * members, projects. Mirrors `ProjectMembersEditor`'s interaction pattern
 * (Combobox picker + table + remove, action call → toast → router.refresh()).
 */
export function TeamDetailEditor({
  team,
  users,
  projects,
  canManageAsAdmin,
}: TeamDetailEditorProps) {
  return (
    <div className="flex flex-col gap-6">
      <DetailsPanel team={team} canManageAsAdmin={canManageAsAdmin} />
      <ManagerSection team={team} users={users} canManageAsAdmin={canManageAsAdmin} />
      <ProductivitySection team={team} />
      <MembersSection team={team} users={users} />
      <ProjectsSection team={team} projects={projects} canManageAsAdmin={canManageAsAdmin} />
    </div>
  );
}

// ── Details ─────────────────────────────────────────────────────────────────

function DetailsPanel({
  team,
  canManageAsAdmin,
}: {
  team: AdminTeamDetail;
  canManageAsAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  function onToggleActive(next: boolean) {
    startTransition(async () => {
      const res = await updateTeam({ teamId: team.id, isActive: next });
      if (res.ok) {
        toast.success(next ? "Team activated" : "Team deactivated");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="glass flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{team.name}</h2>
            <TeamStatusBadge isActive={team.isActive} />
          </div>
          {team.description ? (
            <p className="max-w-prose text-sm text-muted-foreground">{team.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No description</p>
          )}
        </div>

        {canManageAsAdmin ? (
          <div className="flex shrink-0 items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={team.isActive}
                onCheckedChange={onToggleActive}
                disabled={isPending}
                aria-label={team.isActive ? "Deactivate team" : "Activate team"}
              />
              {team.isActive ? "Active" : "Inactive"}
            </label>
            <EditDetailsDialog team={team} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const editDetailsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).optional(),
});
type EditDetailsValues = z.infer<typeof editDetailsSchema>;

function EditDetailsDialog({ team }: { team: AdminTeamDetail }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditDetailsValues>({
    resolver: zodResolver(editDetailsSchema),
    defaultValues: { name: team.name, description: team.description ?? "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Re-seed the form with the current team values every time it opens.
      reset({ name: team.name, description: team.description ?? "" });
      setFormError(null);
    }
  }

  const onSubmit = (values: EditDetailsValues) => {
    setFormError(null);
    startTransition(async () => {
      const res = await updateTeam({
        teamId: team.id,
        name: values.name,
        description: values.description ? values.description : null,
      });
      if (res.ok) {
        toast.success("Team updated");
        setOpen(false);
        router.refresh();
      } else {
        setFormError(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil />
        Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit team</DialogTitle>
          <DialogDescription>Update the team&apos;s name and description.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="et-name">Name</FieldLabel>
              <FieldContent>
                <Input
                  id="et-name"
                  autoComplete="off"
                  aria-invalid={!!errors.name}
                  disabled={isPending}
                  {...register("name")}
                />
                <FieldError errors={[errors.name]} />
              </FieldContent>
            </Field>

            <Field data-invalid={!!errors.description || undefined}>
              <FieldLabel htmlFor="et-description">Description</FieldLabel>
              <FieldContent>
                <Textarea
                  id="et-description"
                  rows={3}
                  aria-invalid={!!errors.description}
                  disabled={isPending}
                  {...register("description")}
                />
                <FieldError errors={[errors.description]} />
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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Manager ─────────────────────────────────────────────────────────────────

function ManagerSection({
  team,
  users,
  canManageAsAdmin,
}: {
  team: AdminTeamDetail;
  users: AssignableUser[];
  canManageAsAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [pickerValue, setPickerValue] = React.useState<string | null>(team.managerId);

  function onAssign(userId: string) {
    setPickerValue(userId);
    startTransition(async () => {
      const res = await assignTeamManager({ teamId: team.id, managerId: userId });
      if (res.ok) {
        toast.success("Manager assigned");
        router.refresh();
      } else {
        toast.error(res.error);
        setPickerValue(team.managerId);
      }
    });
  }

  function onClear() {
    setPickerValue(null);
    startTransition(async () => {
      const res = await assignTeamManager({ teamId: team.id, managerId: null });
      if (res.ok) {
        toast.success("Manager cleared");
        router.refresh();
      } else {
        toast.error(res.error);
        setPickerValue(team.managerId);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-foreground">Manager</h3>
        <p className="text-sm text-muted-foreground">
          The manager can add/remove team members and gains Manager access on
          every project this team is assigned to.
        </p>
      </div>

      {canManageAsAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <Combobox
            items={users.map((u) => ({ value: u.id, label: u.name, hint: u.email }))}
            value={pickerValue}
            onValueChange={onAssign}
            placeholder="Select a manager"
            searchPlaceholder="Search users…"
            emptyText="No users found."
            disabled={isPending}
            triggerClassName="w-full sm:w-64"
          />
          {pickerValue ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={isPending}
              className="text-muted-foreground hover:text-danger"
            >
              <X />
              Clear
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-foreground">
          {team.managerName ?? (
            <span className="text-muted-foreground italic">No manager assigned</span>
          )}
        </p>
      )}
    </div>
  );
}

// ── Productivity visibility (#8) ───────────────────────────────────────────

/**
 * Team Productivity Visibility (#8) toggle. Available to Admin AND the
 * team's own delegated manager — same authority as `MembersSection`'s
 * add/remove (both are authorised server-side by `requireTeamManage`), so
 * this section is deliberately NOT gated on `canManageAsAdmin` the way
 * `DetailsPanel`/`ManagerSection`/`ProjectsSection`'s edit controls are.
 */
function ProductivitySection({ team }: { team: AdminTeamDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  function onToggle(next: boolean) {
    startTransition(async () => {
      const res = await setTeamProductivityVisibility({ teamId: team.id, visible: next });
      if (res.ok) {
        toast.success(
          next
            ? "Members can now see each other's productivity"
            : "Productivity is private to the manager again",
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-foreground">Productivity visibility</h3>
        <p className="text-sm text-muted-foreground">
          When on, members of this team can see each other&apos;s task status,
          completion %, and hours on the <code className="text-xs">/team</code> view.
        </p>
      </div>

      <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
        <Switch
          checked={team.membersCanSeeProductivity}
          onCheckedChange={onToggle}
          disabled={isPending}
          aria-label={
            team.membersCanSeeProductivity
              ? "Turn off member productivity visibility"
              : "Turn on member productivity visibility"
          }
        />
        Members can see each other&apos;s productivity
      </label>
    </div>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

function MembersSection({
  team,
  users,
}: {
  team: AdminTeamDetail;
  users: AssignableUser[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [addUserId, setAddUserId] = React.useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<AdminTeamMember | null>(null);

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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-foreground">Members</h3>
        <p className="text-sm text-muted-foreground">
          Everyone on the team — they inherit access to every project this
          team is assigned to.
        </p>
      </div>

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

      {team.members.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          No members yet. Add someone above.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    <span className="flex items-center gap-2.5">
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
                    </span>
                  </TableCell>
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
              any access this team grants. You can add them again at any time.
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

// ── Projects ────────────────────────────────────────────────────────────────

function ProjectsSection({
  team,
  projects,
  canManageAsAdmin,
}: {
  team: AdminTeamDetail;
  projects: AdminProjectRow[];
  canManageAsAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [addProjectId, setAddProjectId] = React.useState<string | null>(null);
  const [addRole, setAddRole] = React.useState<ProjectRole>("MEMBER");
  const [removeTarget, setRemoveTarget] = React.useState<AdminTeamProject | null>(null);

  const assignedIds = new Set(team.projects.map((p) => p.projectId));
  const available = projects.filter((p) => !assignedIds.has(p.id));

  function onAssign() {
    if (!addProjectId) return;
    startTransition(async () => {
      const res = await assignTeamProject({
        teamId: team.id,
        projectId: addProjectId,
        role: addRole,
      });
      if (res.ok) {
        toast.success("Project assigned");
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
      const res = await updateTeamProjectRole({ teamId: team.id, projectId, role });
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
      const res = await unassignTeamProject({ teamId: team.id, projectId });
      if (res.ok) {
        toast.success("Project unassigned");
        setRemoveTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-foreground">Projects</h3>
        <p className="text-sm text-muted-foreground">
          Projects this team is assigned to, and the role it grants every team
          member on that project.
        </p>
      </div>

      {canManageAsAdmin ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center">
          <Combobox
            items={available.map((p) => ({ value: p.id, label: p.name, hint: p.key }))}
            value={addProjectId}
            onValueChange={setAddProjectId}
            placeholder={available.length ? "Select a project" : "No projects to add"}
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
            aria-label="Role for the new project assignment"
          />
          <Button
            type="button"
            size="sm"
            onClick={onAssign}
            disabled={isPending || !addProjectId}
            className="sm:ml-auto"
          >
            <Plus />
            Assign project
          </Button>
        </div>
      ) : null}

      {team.projects.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          Not assigned to any projects yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Project</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Role</TableHead>
                {canManageAsAdmin ? <TableHead className="w-10" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.projects.map((p) => (
                <TableRow key={p.projectId}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="rounded-sm bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {p.key}
                      </span>
                      <span className="font-medium text-foreground">{p.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[...new Set(p.leads)].join(", ")}
                  </TableCell>
                  <TableCell>
                    {canManageAsAdmin ? (
                      <ProjectRoleSelect
                        value={p.role}
                        onValueChange={(role) => onChangeRole(p.projectId, role)}
                        disabled={isPending}
                        aria-label={`Role for ${p.name}`}
                      />
                    ) : (
                      <span className="text-sm text-foreground">{p.role}</span>
                    )}
                  </TableCell>
                  {canManageAsAdmin ? (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-danger"
                        aria-label={`Unassign ${p.name}`}
                        disabled={isPending}
                        onClick={() => setTimeout(() => setRemoveTarget(p), 0)}
                      >
                        <X />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign project?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{team.name}</strong> and its
              members will lose the access this assignment grants on{" "}
              <strong className="text-foreground">{removeTarget?.name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={isPending} onClick={onRemove}>
              {isPending ? "Removing…" : "Unassign"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
