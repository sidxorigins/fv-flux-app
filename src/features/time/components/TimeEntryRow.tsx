"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteTimeEntry, updateTimeEntry } from "../actions"
import { formatMinutes, parseDuration } from "../format"
import type { TimeEntryRow as Entry } from "../queries"

export interface TimeEntryRowProps {
  entry: Entry
  /** Owner or project MANAGER/Admin — may inline-edit + delete this entry. */
  canEdit: boolean
}

/**
 * One logged-time row. When `canEdit`, the duration is click-to-edit: it opens
 * an input that accepts "2h 30m" / "90m" / a bare minute count (parsed by
 * parseDuration) and commits through the updateTimeEntry action on Enter/blur;
 * Escape cancels. Read-only rows render the duration as plain text.
 */
export function TimeEntryRow({ entry, canEdit }: TimeEntryRowProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(() => formatMinutes(entry.minutes))

  // Resync the draft if the entry's minutes change underneath us (our own save,
  // or an external edit) — render-phase adjustment, no effect cascade.
  const [synced, setSynced] = React.useState(entry.minutes)
  if (synced !== entry.minutes) {
    setSynced(entry.minutes)
    setDraft(formatMinutes(entry.minutes))
    setEditing(false)
  }

  function commit() {
    const minutes = parseDuration(draft)
    if (minutes === null) {
      toast.error('Enter a duration like "2h 30m" or "90"')
      return
    }
    if (minutes === entry.minutes) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      const res = await updateTimeEntry({ id: entry.id, minutes })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Time updated")
      setEditing(false)
      router.refresh()
    })
  }

  function onDelete() {
    startTransition(async () => {
      const res = await deleteTimeEntry({ id: entry.id })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <li className="flex items-center gap-2 text-xs text-muted-foreground">
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              setDraft(formatMinutes(entry.minutes))
              setEditing(false)
            }
          }}
          disabled={isPending}
          aria-label="Edit logged time"
          className="h-6 w-24 py-0 text-xs tabular-nums"
        />
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={isPending}
          className="rounded px-1 tabular-nums text-foreground outline-none hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-ring/50"
          title="Click to edit logged time"
        >
          {formatMinutes(entry.minutes)}
        </button>
      ) : (
        <span className="tabular-nums text-foreground">{formatMinutes(entry.minutes)}</span>
      )}

      <span className="min-w-0 flex-1 truncate">
        {entry.user.name} · {new Date(entry.startedAt).toLocaleDateString()}
      </span>

      {canEdit ? (
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0 text-muted-foreground hover:text-danger"
          onClick={onDelete}
          disabled={isPending}
          aria-label={`Delete ${formatMinutes(entry.minutes)} entry`}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </li>
  )
}
