"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Label as ProjectLabel, User } from "@/generated/prisma/client"

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
}

/**
 * Backlog filter bar. Every control writes straight to URL params (server
 * refetch on navigation, no client cache) — this is the "single source of
 * truth in the URL" half of the locked drawer architecture applied to
 * filtering too. Search is debounced; changing any filter resets `cursor` so
 * pagination restarts from page one.
 */
export function TaskFilters({ members, labels }: TaskFiltersProps) {
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
