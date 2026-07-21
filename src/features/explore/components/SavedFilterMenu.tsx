"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Bookmark, Loader2, Save, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import type { SavedFilter } from "@/generated/prisma/client"

import { createSavedFilter, deleteSavedFilter } from "../saved-filter-actions"

export interface SavedFilterMenuProps {
  savedFilters: SavedFilter[]
}

/**
 * "Saved" popover for the Task Explorer — mirrors TaskFilters' SavedViewsMenu,
 * adapted for the global (no projectId) SavedFilter model: apply PUSHES the
 * saved query (so the back button returns to whatever was being filtered
 * before), matching the brief; delete/save both `router.refresh()` so the
 * server-fetched `savedFilters` prop picks up the change.
 */
export function SavedFilterMenu({ savedFilters }: SavedFilterMenuProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  function applyFilter(query: string) {
    setOpen(false)
    router.push(query ? `/explore?${query}` : "/explore")
  }

  function onSave(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    startTransition(async () => {
      const res = await createSavedFilter({
        name,
        query: searchParams.toString(),
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Saved filter "${name}"`)
      setNewName("")
      setSaving(false)
      router.refresh()
    })
  }

  function onDelete(id: string, name: string) {
    startTransition(async () => {
      const res = await deleteSavedFilter(id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Deleted filter "${name}"`)
      router.refresh()
    })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setSaving(false)
          setNewName("")
        }
      }}
    >
      <PopoverTrigger
        render={<Button variant="outline" size="sm" aria-label="Saved filters" />}
      >
        <Bookmark aria-hidden />
        Saved
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        {savedFilters.length === 0 ? (
          <p className="px-1 py-1 text-sm text-muted-foreground">
            No saved filters yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {savedFilters.map((filter) => (
              <li key={filter.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => applyFilter(filter.query)}
                  disabled={isPending}
                  className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors duration-150 hover:bg-surface-raised motion-reduce:transition-none"
                >
                  {filter.name}
                </button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-danger"
                  onClick={() => onDelete(filter.id, filter.name)}
                  disabled={isPending}
                  aria-label={`Delete filter ${filter.name}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Separator className="my-2" />

        {saving ? (
          <form onSubmit={onSave} className="flex items-center gap-1.5">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Filter name…"
              maxLength={60}
              disabled={isPending}
              aria-label="New saved filter name"
              className="h-8 flex-1"
            />
            <Button
              type="submit"
              size="icon-sm"
              disabled={isPending || !newName.trim()}
              aria-label="Save filter"
            >
              {isPending ? (
                <Loader2
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <Save aria-hidden />
              )}
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                setSaving(false)
                setNewName("")
              }}
              disabled={isPending}
              aria-label="Cancel"
            >
              <X aria-hidden />
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => setSaving(true)}
          >
            <Save aria-hidden />
            Save current filters…
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
