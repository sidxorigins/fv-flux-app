"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Bookmark, Loader2, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import type { Label as ProjectLabel, User } from "@/generated/prisma/client"

import { createSavedView, deleteSavedView } from "@/features/saved-views/actions"
import type { SavedViewSummary } from "@/features/saved-views/queries"

import { PRIORITY_META, PRIORITY_ORDER } from "./PriorityBadge"
import { STATUS_META, STATUS_ORDER } from "./StatusBadge"
import { TYPE_META } from "./TypeIcon"

type Member = Pick<User, "id" | "name" | "username" | "avatarKey">

const ALL = "ALL"
const TYPE_ORDER = ["TASK", "BUG", "STORY"] as const
const FILTER_KEYS = ["status", "type", "priority", "assigneeId", "labelId", "q"]

export interface TaskFiltersProps {
  members: Member[]
  labels: ProjectLabel[]
  projectId: string
  savedViews: SavedViewSummary[]
}

/**
 * Compact "Views" popover: save the current filter/sort URL under a name and
 * re-apply or delete saved ones later. Selecting a view fully replaces the URL
 * with its stored query (it was captured from `searchParams.toString()` at save
 * time, so it already carries `view=backlog` and everything else needed to land
 * back on this same screen) — nothing from the current URL is merged in.
 */
function SavedViewsMenu({
  projectId,
  savedViews,
}: {
  projectId: string
  savedViews: SavedViewSummary[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  function applyView(query: string) {
    setOpen(false)
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  function onSave(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    startTransition(async () => {
      const res = await createSavedView({
        projectId,
        name,
        query: searchParams.toString(),
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Saved view "${name}"`)
      setNewName("")
      setSaving(false)
      router.refresh()
    })
  }

  function onDelete(id: string, name: string) {
    startTransition(async () => {
      const res = await deleteSavedView(id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Deleted view "${name}"`)
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
        render={<Button variant="outline" size="sm" aria-label="Saved views" />}
      >
        <Bookmark aria-hidden />
        Views
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        {savedViews.length === 0 ? (
          <p className="px-1 py-1 text-sm text-muted-foreground">
            No saved views yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {savedViews.map((view) => (
              <li key={view.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => applyView(view.query)}
                  disabled={isPending}
                  className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors duration-150 hover:bg-surface-raised motion-reduce:transition-none"
                >
                  {view.name}
                </button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground hover:text-danger"
                  onClick={() => onDelete(view.id, view.name)}
                  disabled={isPending}
                  aria-label={`Delete view ${view.name}`}
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
              placeholder="View name…"
              maxLength={40}
              disabled={isPending}
              aria-label="New view name"
              className="h-8 flex-1"
            />
            <Button
              type="submit"
              size="icon-sm"
              disabled={isPending || !newName.trim()}
              aria-label="Save view"
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
            Save current view…
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Backlog filter bar. Every control writes straight to URL params (server
 * refetch on navigation, no client cache) — this is the "single source of
 * truth in the URL" half of the locked drawer architecture applied to
 * filtering too. Search is debounced; changing any filter resets `cursor` so
 * pagination restarts from page one.
 */
export function TaskFilters({
  members,
  labels,
  projectId,
  savedViews,
}: TaskFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentQuery = searchParams.get("q") ?? ""
  const [query, setQuery] = React.useState(currentQuery)

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    params.delete("cursor")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  // Debounced push: only navigate once the typed value settles.
  React.useEffect(() => {
    if (query === currentQuery) return
    const t = setTimeout(() => updateParam("q", query.trim() || null), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const status = searchParams.get("status") ?? ALL
  const type = searchParams.get("type") ?? ALL
  const priority = searchParams.get("priority") ?? ALL
  const assigneeId = searchParams.get("assigneeId") ?? ALL
  const labelId = searchParams.get("labelId") ?? ALL

  const hasActiveFilters =
    status !== ALL ||
    type !== ALL ||
    priority !== ALL ||
    assigneeId !== ALL ||
    labelId !== ALL ||
    currentQuery !== ""

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of FILTER_KEYS) params.delete(key)
    params.delete("cursor")
    setQuery("")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative col-span-2 sm:col-span-1 sm:flex-1 sm:min-w-48">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or key…"
          aria-label="Search tasks"
          className="pl-8"
        />
      </div>

      <Select
        value={status}
        onValueChange={(v) => updateParam("status", v === ALL ? null : v)}
      >
        <SelectTrigger aria-label="Filter by status" className="w-full sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {STATUS_ORDER.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_META[s].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={type}
        onValueChange={(v) => updateParam("type", v === ALL ? null : v)}
      >
        <SelectTrigger aria-label="Filter by type" className="w-full sm:w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All types</SelectItem>
          {TYPE_ORDER.map((t) => (
            <SelectItem key={t} value={t}>
              {TYPE_META[t].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={priority}
        onValueChange={(v) => updateParam("priority", v === ALL ? null : v)}
      >
        <SelectTrigger aria-label="Filter by priority" className="w-full sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All priorities</SelectItem>
          {PRIORITY_ORDER.map((p) => (
            <SelectItem key={p} value={p}>
              {PRIORITY_META[p].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {members.length > 0 ? (
        <Select
          value={assigneeId}
          onValueChange={(v) => updateParam("assigneeId", v === ALL ? null : v)}
        >
          <SelectTrigger aria-label="Filter by assignee" className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All assignees</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {labels.length > 0 ? (
        <Select
          value={labelId}
          onValueChange={(v) => updateParam("labelId", v === ALL ? null : v)}
        >
          <SelectTrigger aria-label="Filter by label" className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All labels</SelectItem>
            {labels.map((label) => (
              <SelectItem key={label.id} value={label.id}>
                {label.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <SavedViewsMenu projectId={projectId} savedViews={savedViews} />

      {hasActiveFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          className="text-muted-foreground"
        >
          <X />
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
