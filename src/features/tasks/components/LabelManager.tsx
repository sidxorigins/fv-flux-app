"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Pencil, Plus, Tag, Trash2, X } from "lucide-react"
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
  AlertDialogTrigger,
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Label as ProjectLabel } from "@/generated/prisma/client"

import { createLabel, deleteLabel, updateLabel } from "../labels"

/** Preset swatches drawn from the functional design tokens (see globals.css). */
const SWATCHES = [
  "#5B8DEF", // info
  "#3CCF91", // success
  "#F5A623", // warning
  "#F5455C", // danger
  "#FF6B35", // primary
  "#9A9A9A", // muted
] as const

const DEFAULT_COLOR = SWATCHES[0]

function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (color: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      {SWATCHES.map((swatch) => (
        <button
          key={swatch}
          type="button"
          disabled={disabled}
          onClick={() => onChange(swatch)}
          aria-label={`Use colour ${swatch}`}
          aria-pressed={value.toLowerCase() === swatch.toLowerCase()}
          className={cn(
            "size-6 rounded-full outline-none transition-transform duration-150",
            "focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
            value.toLowerCase() === swatch.toLowerCase()
              ? "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background"
              : "hover:scale-110",
          )}
          style={{ backgroundColor: swatch }}
        />
      ))}
    </div>
  )
}

export interface LabelManagerProps {
  projectId: string
  labels: ProjectLabel[]
  /** MEMBER+ may create/rename/recolour. */
  canEdit: boolean
  /** MANAGER+ may delete. */
  canManage: boolean
}

/**
 * Manage a project's labels: create, rename, recolour, delete. Opens from the
 * project settings menu. Create/rename/recolour are MEMBER+; delete is
 * MANAGER+ (destructive — removes the label from every task).
 */
export function LabelManager({
  projectId,
  labels,
  canEdit,
  canManage,
}: LabelManagerProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  // Create form
  const [newName, setNewName] = React.useState("")
  const [newColor, setNewColor] = React.useState<string>(DEFAULT_COLOR)

  // Inline edit
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState("")
  const [editColor, setEditColor] = React.useState<string>(DEFAULT_COLOR)

  function resetCreate() {
    setNewName("")
    setNewColor(DEFAULT_COLOR)
  }

  function onCreate(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    startTransition(async () => {
      const res = await createLabel({ projectId, name, color: newColor })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      resetCreate()
      router.refresh()
    })
  }

  function startEdit(label: ProjectLabel) {
    setEditingId(label.id)
    setEditName(label.name)
    setEditColor(label.color)
  }

  function saveEdit(labelId: string) {
    const name = editName.trim()
    if (!name) return
    startTransition(async () => {
      const res = await updateLabel({ labelId, name, color: editColor })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setEditingId(null)
      router.refresh()
    })
  }

  function onDelete(labelId: string) {
    startTransition(async () => {
      const res = await deleteLabel({ labelId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" aria-label="Manage labels" />
        }
      >
        <Tag aria-hidden />
        Labels
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Labels</DialogTitle>
          <DialogDescription>
            Create, rename, recolour, and remove this project&apos;s labels.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {labels.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No labels yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {labels.map((label) => (
                <li
                  key={label.id}
                  className="flex items-center gap-2 rounded-lg px-1 py-1.5"
                >
                  {editingId === label.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={40}
                        disabled={isPending}
                        className="h-8 flex-1"
                        aria-label="Label name"
                      />
                      <ColorPicker
                        value={editColor}
                        onChange={setEditColor}
                        disabled={isPending}
                      />
                      <Button
                        size="icon-sm"
                        onClick={() => saveEdit(label.id)}
                        disabled={isPending || !editName.trim()}
                        aria-label="Save label"
                      >
                        <Check aria-hidden />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                        disabled={isPending}
                        aria-label="Cancel"
                      >
                        <X aria-hidden />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: label.color }}
                        aria-hidden
                      />
                      <span className="flex-1 truncate text-sm text-foreground">
                        {label.name}
                      </span>
                      {canEdit ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => startEdit(label)}
                          disabled={isPending}
                          aria-label={`Edit ${label.name}`}
                        >
                          <Pencil aria-hidden />
                        </Button>
                      ) : null}
                      {canManage ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="text-muted-foreground hover:text-danger"
                                aria-label={`Delete ${label.name}`}
                              />
                            }
                          >
                            <Trash2 aria-hidden />
                          </AlertDialogTrigger>
                          <AlertDialogContent size="sm">
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete “{label.name}”?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the label from every task in the
                                project. This can&apos;t be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => onDelete(label.id)}
                                disabled={isPending}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canEdit ? (
          <form
            onSubmit={onCreate}
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New label name…"
                maxLength={40}
                disabled={isPending}
                aria-label="New label name"
                className="flex-1"
              />
              <Button
                type="submit"
                size="icon"
                disabled={isPending || !newName.trim()}
                aria-label="Create label"
              >
                {isPending ? (
                  <Loader2
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                ) : (
                  <Plus aria-hidden />
                )}
              </Button>
            </div>
            <ColorPicker
              value={newColor}
              onChange={setNewColor}
              disabled={isPending}
            />
          </form>
        ) : null}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
