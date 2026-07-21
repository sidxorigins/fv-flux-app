"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ListFilter, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import type { SavedFilter } from "@/generated/prisma/client"
import type { TaskType } from "@/generated/prisma/enums"

import { Combobox, type ComboboxItem } from "@/features/admin/components/Combobox"
import {
  PRIORITY_META,
  PRIORITY_ORDER,
  STATUS_META,
  STATUS_ORDER,
  TYPE_META,
} from "@/features/tasks/components"
import type { ExploreOptions } from "../queries"

import { SavedFilterMenu } from "./SavedFilterMenu"

const ALL = "ALL"
const UNASSIGNED = "UNASSIGNED"
const TYPE_ORDER = ["TASK", "BUG", "STORY"] as const satisfies readonly TaskType[]

/** Every filter querystring key this bar can write — drives "Clear all" / the active-filter count. */
const FILTER_KEYS = [
  "projectId",
  "teamId",
  "managerId",
  "leadId",
  "assigneeId",
  "unassigned",
  "type",
  "status",
  "priority",
  "labelId",
  "dueFrom",
  "dueTo",
  "createdFrom",
  "createdTo",
  "overdue",
  "noEstimate",
  "overEstimate",
] as const

export interface ExploreFilterBarProps {
  options: ExploreOptions
  savedFilters: SavedFilter[]
}

/**
 * A single date-range endpoint, debounced like TaskFilters' search box: local
 * state absorbs picker changes and only pushes to the URL 300ms after the
 * value settles. When the URL's value changes for a reason OTHER than this
 * field's own debounced push (Clear all, or applying a saved filter), local
 * state is resynced — but as a render-time state adjustment (React's
 * documented "adjusting state when a prop changes" pattern), not inside a
 * `useEffect`, so there's no extra commit-then-resync render pass. Right
 * after our own push this is a no-op, since `current` already equals `value`
 * by then.
 */
function useDebouncedDateParam(
  paramKey: string,
  searchParams: URLSearchParams,
  commit: (key: string, value: string | null) => void,
): [string, (v: string) => void] {
  const current = searchParams.get(paramKey) ?? ""
  const [prevCurrent, setPrevCurrent] = React.useState(current)
  const [value, setValue] = React.useState(current)

  if (current !== prevCurrent) {
    setPrevCurrent(current)
    setValue(current)
  }

  React.useEffect(() => {
    if (value === current) return
    const t = setTimeout(() => commit(paramKey, value || null), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return [value, setValue]
}

/**
 * The Task Explorer's filter bar — every control is URL-driven, mirroring
 * TaskFilters: selects/combobox apply immediately via `router.replace`, date
 * inputs debounce. Any change drops `page` so pagination restarts. "Clear
 * all" drops the whole querystring; the saved-filters popover lives here too.
 */
export function ExploreFilterBar({ options, savedFilters }: ExploreFilterBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function updateParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    params.delete("page")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  function updateParam(key: string, value: string | null) {
    updateParams({ [key]: value })
  }

  const [dueFrom, setDueFrom] = useDebouncedDateParam("dueFrom", searchParams, updateParam)
  const [dueTo, setDueTo] = useDebouncedDateParam("dueTo", searchParams, updateParam)
  const [createdFrom, setCreatedFrom] = useDebouncedDateParam(
    "createdFrom",
    searchParams,
    updateParam,
  )
  const [createdTo, setCreatedTo] = useDebouncedDateParam("createdTo", searchParams, updateParam)

  const projectId = searchParams.get("projectId") ?? ALL
  const teamId = searchParams.get("teamId") ?? ALL
  const managerId = searchParams.get("managerId") ?? ALL
  const leadId = searchParams.get("leadId") ?? ALL
  const type = searchParams.get("type") ?? ALL
  const status = searchParams.get("status") ?? ALL
  const priority = searchParams.get("priority") ?? ALL
  const labelId = searchParams.get("labelId") ?? ALL

  const isUnassigned = searchParams.get("unassigned") === "true"
  const assigneeId = searchParams.get("assigneeId")
  const assigneeValue = isUnassigned ? UNASSIGNED : (assigneeId ?? ALL)

  const overdue = searchParams.get("overdue") === "true"
  const noEstimate = searchParams.get("noEstimate") === "true"
  const overEstimate = searchParams.get("overEstimate") === "true"

  // Base UI's <SelectValue> renders the raw value unless the Root is given an
  // `items` value→label map (see TaskFilters) — every select below needs one.
  const projectItems: ComboboxItem[] = React.useMemo(
    () => [
      { value: ALL, label: "All projects" },
      ...options.projects.map((p) => ({ value: p.id, label: p.name, hint: p.key })),
    ],
    [options.projects],
  )
  const typeItems = React.useMemo(
    () => ({
      [ALL]: "All types",
      ...Object.fromEntries(TYPE_ORDER.map((t) => [t, TYPE_META[t].label])),
    }),
    [],
  )
  const statusItems = React.useMemo(
    () => ({
      [ALL]: "All statuses",
      ...Object.fromEntries(STATUS_ORDER.map((s) => [s, STATUS_META[s].label])),
    }),
    [],
  )
  const priorityItems = React.useMemo(
    () => ({
      [ALL]: "All priorities",
      ...Object.fromEntries(PRIORITY_ORDER.map((p) => [p, PRIORITY_META[p].label])),
    }),
    [],
  )
  const teamItems = React.useMemo(
    () => ({
      [ALL]: "All teams",
      ...Object.fromEntries(options.teams.map((t) => [t.id, t.name])),
    }),
    [options.teams],
  )
  const managerItems = React.useMemo(
    () => ({
      [ALL]: "All managers",
      ...Object.fromEntries(options.managers.map((m) => [m.id, m.name])),
    }),
    [options.managers],
  )
  const leadItems = React.useMemo(
    () => ({
      [ALL]: "All leads",
      ...Object.fromEntries(options.leads.map((l) => [l.id, l.name])),
    }),
    [options.leads],
  )
  const labelItems = React.useMemo(
    () => ({
      [ALL]: "All tags",
      ...Object.fromEntries(options.labels.map((l) => [l.id, l.name])),
    }),
    [options.labels],
  )
  const assigneeItems = React.useMemo(
    () => ({
      [ALL]: "All assignees",
      [UNASSIGNED]: "Unassigned",
      ...Object.fromEntries(options.assignees.map((a) => [a.id, a.name])),
    }),
    [options.assignees],
  )

  // `unassigned` and `assigneeId` both target the same underlying condition
  // (see exploreTaskWhere) — this is the only place the bar ever sets both at
  // once, and it always clears the other so they can't both linger in the URL.
  function setAssignee(value: string | null) {
    if (value === ALL || value === null) updateParams({ assigneeId: null, unassigned: null })
    else if (value === UNASSIGNED) updateParams({ assigneeId: null, unassigned: "true" })
    else updateParams({ assigneeId: value, unassigned: null })
  }

  const activeCount = FILTER_KEYS.filter((key) => searchParams.get(key) !== null).length

  function clearAll() {
    setDueFrom("")
    setDueTo("")
    setCreatedFrom("")
    setCreatedTo("")
    router.replace(pathname)
  }

  return (
    <div className="glass flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListFilter aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Filters
        </span>
        {activeCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
            {activeCount}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <SavedFilterMenu savedFilters={savedFilters} />
          {activeCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="text-muted-foreground"
            >
              <X aria-hidden />
              Clear all
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center">
        <Combobox
          items={projectItems}
          value={projectId}
          onValueChange={(v) => updateParam("projectId", v === ALL ? null : v)}
          placeholder="All projects"
          searchPlaceholder="Search projects…"
          triggerClassName="col-span-2 w-full sm:col-span-1 sm:w-52"
        />

        <Select
          value={teamId}
          items={teamItems}
          onValueChange={(v) => updateParam("teamId", v === ALL ? null : v)}
        >
          <SelectTrigger aria-label="Filter by team" className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All teams</SelectItem>
            {options.teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={managerId}
          items={managerItems}
          onValueChange={(v) => updateParam("managerId", v === ALL ? null : v)}
        >
          <SelectTrigger aria-label="Filter by manager" className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All managers</SelectItem>
            {options.managers.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={leadId}
          items={leadItems}
          onValueChange={(v) => updateParam("leadId", v === ALL ? null : v)}
        >
          <SelectTrigger aria-label="Filter by project lead" className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All leads</SelectItem>
            {options.leads.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={assigneeValue} items={assigneeItems} onValueChange={setAssignee}>
          <SelectTrigger aria-label="Filter by assignee" className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All assignees</SelectItem>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {options.assignees.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={type}
          items={typeItems}
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
          value={status}
          items={statusItems}
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
          value={priority}
          items={priorityItems}
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

        {options.labels.length > 0 ? (
          <Select
            value={labelId}
            items={labelItems}
            onValueChange={(v) => updateParam("labelId", v === ALL ? null : v)}
          >
            <SelectTrigger aria-label="Filter by tag" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tags</SelectItem>
              {options.labels.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <Separator />

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Due</Label>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={dueFrom}
              onChange={(e) => setDueFrom(e.target.value)}
              aria-label="Due from"
              className="w-36"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={dueTo}
              onChange={(e) => setDueTo(e.target.value)}
              aria-label="Due to"
              className="w-36"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Created</Label>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
              aria-label="Created from"
              className="w-36"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
              aria-label="Created to"
              className="w-36"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 sm:ml-auto">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch
              size="sm"
              checked={overdue}
              onCheckedChange={(checked) => updateParam("overdue", checked ? "true" : null)}
              aria-label="Overdue only"
            />
            Overdue
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch
              size="sm"
              checked={noEstimate}
              onCheckedChange={(checked) => updateParam("noEstimate", checked ? "true" : null)}
              aria-label="No estimate only"
            />
            No estimate
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch
              size="sm"
              checked={overEstimate}
              onCheckedChange={(checked) => updateParam("overEstimate", checked ? "true" : null)}
              aria-label="Over estimate only"
            />
            Over estimate
          </label>
        </div>
      </div>
    </div>
  )
}
