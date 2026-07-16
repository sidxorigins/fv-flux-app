"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { MoreVertical, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldContent,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { deleteProject, updateProject } from "@/features/projects/actions"

export interface ProjectSettingsMenuProps {
  project: {
    id: string
    key: string
    name: string
    description: string | null
  }
  /** MANAGER+ (or global Admin) — can rename/re-describe the project. */
  canManage: boolean
  /** Global Admin only — can delete the project. */
  isAdmin: boolean
}

/**
 * Project header's settings dropdown: MANAGER can rename/re-describe;
 * Admin-only, type-the-key-to-confirm delete. Self-contained (owns both
 * dialogs) so the page header stays a thin trigger.
 */
export function ProjectSettingsMenu({
  project,
  canManage,
  isAdmin,
}: ProjectSettingsMenuProps) {
  const router = useRouter()
  const [editOpen, setEditOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [name, setName] = React.useState(project.name)
  const [description, setDescription] = React.useState(
    project.description ?? "",
  )
  const [confirmKey, setConfirmKey] = React.useState("")
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  if (!canManage && !isAdmin) return null

  function saveEdit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setFormError(null)
    startTransition(async () => {
      const res = await updateProject(project.id, {
        name: name.trim(),
        description: description.trim() || null,
      })
      if (!res.ok) {
        setFormError(res.error)
        return
      }
      toast.success("Project updated")
      setEditOpen(false)
      router.refresh()
    })
  }

  function confirmDelete() {
    startTransition(async () => {
      const res = await deleteProject(project.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Project deleted")
      router.push("/projects")
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Project settings"
            />
          }
        >
          <MoreVertical aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canManage ? (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden />
              Edit project
            </DropdownMenuItem>
          ) : null}
          {isAdmin ? (
            <>
              {canManage ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 aria-hidden />
                Delete project
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              Update the name and description.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="ep-name">Name</FieldLabel>
              <FieldContent>
                <Input
                  id="ep-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={isPending}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel htmlFor="ep-description">Description</FieldLabel>
              <FieldContent>
                <Textarea
                  id="ep-description"
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={isPending}
                />
              </FieldContent>
            </Field>
            {formError ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={isPending || !name.trim()}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(next) => {
          setDeleteOpen(next)
          if (!next) setConfirmKey("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the project and every task, comment,
              and attachment in it. Type{" "}
              <span className="font-mono text-foreground">{project.key}</span>{" "}
              to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmKey}
            onChange={(event) => setConfirmKey(event.target.value)}
            placeholder={project.key}
            className="font-mono uppercase"
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDelete}
              disabled={
                isPending || confirmKey.trim().toUpperCase() !== project.key
              }
            >
              {isPending ? "Deleting…" : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
