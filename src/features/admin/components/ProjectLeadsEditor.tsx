"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Crown, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { addProjectLead, removeProjectLead, setPrimaryLead } from "../actions";
import type { AdminProjectLead, AssignableUser } from "../queries";
import { Combobox } from "./Combobox";
import { initials } from "./display";

interface ProjectLeadsEditorProps {
  projectId: string;
  projectName: string;
  leads: AdminProjectLead[];
  users: AssignableUser[];
}

/**
 * Manage a project's leads: the required primary lead plus any number of
 * co-leads. Both grant MANAGER-equivalent access via access-sync (see
 * `getProjectLeads`). The primary can never be removed directly — it must be
 * reassigned via "Make primary" on a co-lead first, which the server also
 * enforces; the disabled remove button + tooltip here is a UX guardrail, not
 * the security boundary.
 */
export function ProjectLeadsEditor({
  projectId,
  projectName,
  leads,
  users,
}: ProjectLeadsEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [addUserId, setAddUserId] = React.useState<string | null>(null);

  const leadIds = new Set(leads.map((l) => l.userId));
  const available = users.filter((u) => !leadIds.has(u.id));

  function onAdd() {
    if (!addUserId) return;
    startTransition(async () => {
      const res = await addProjectLead({ projectId, userId: addUserId });
      if (res.ok) {
        toast.success("Lead added");
        setAddUserId(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function onRemove(lead: AdminProjectLead) {
    startTransition(async () => {
      const res = await removeProjectLead({ projectId, userId: lead.userId });
      if (res.ok) {
        toast.success("Lead removed");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function onMakePrimary(lead: AdminProjectLead) {
    startTransition(async () => {
      const res = await setPrimaryLead({ projectId, userId: lead.userId });
      if (res.ok) {
        toast.success(`${lead.name} is now the primary lead`);
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
        <Button
          type="button"
          size="sm"
          onClick={onAdd}
          disabled={isPending || !addUserId}
          className="sm:ml-auto"
        >
          <Plus />
          Add lead
        </Button>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          No leads set for {projectName}.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-44 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.userId}>
                  <TableCell>
                    <span className="flex items-center gap-2.5">
                      <Avatar size="sm">
                        <AvatarFallback className="text-[10px]">
                          {initials(lead.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate font-medium text-foreground">
                          {lead.name}
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          @{lead.username}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    {lead.isPrimary ? (
                      <Badge className="gap-1">
                        <Crown className="size-3" aria-hidden />
                        Primary
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Co-lead</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {!lead.isPrimary ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => onMakePrimary(lead)}
                        >
                          <Crown />
                          Make primary
                        </Button>
                      ) : null}
                      {lead.isPrimary ? (
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex" />}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground"
                              aria-label={`Remove ${lead.name}`}
                              disabled
                            >
                              <X />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Set another primary first</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-danger"
                          aria-label={`Remove ${lead.name}`}
                          disabled={isPending}
                          onClick={() => onRemove(lead)}
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
