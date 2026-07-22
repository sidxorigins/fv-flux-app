"use client"

import * as React from "react"
import { Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ProjectMembersEditor } from "@/features/admin/components/ProjectMembersEditor"
import type {
  AdminProjectMember,
  AssignableUser,
} from "@/features/admin/queries"

export interface ManageMembersDialogProps {
  projectId: string
  projectName: string
  members: AdminProjectMember[]
  users: AssignableUser[]
}

/**
 * Project-page member management for MANAGERs (delegation — no admin area
 * needed). Reuses the admin ProjectMembersEditor, but without the
 * /admin/users links a non-admin manager can't follow.
 */
export function ManageMembersDialog({
  projectId,
  projectName,
  members,
  users,
}: ManageMembersDialogProps) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Manage members" />
        }
      >
        <Users aria-hidden />
        Members
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Members</DialogTitle>
          <DialogDescription>
            Add people to {projectName}, change their role, or remove them.
          </DialogDescription>
        </DialogHeader>
        <ProjectMembersEditor
          projectId={projectId}
          projectName={projectName}
          members={members}
          users={users}
          linkToAdmin={false}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
