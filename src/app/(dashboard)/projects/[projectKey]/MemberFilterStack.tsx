"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Check } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  isAssigneeSelected,
  toggleAssigneeValue,
} from "@/features/tasks/assigneeFilter"
import { AssigneeAvatar } from "@/features/tasks/components"
import { cn } from "@/lib/utils"

import { chipOffset, collapsedWidth, expandedWidth } from "./memberStackLayout"

export interface FilterMember {
  id: string
  name: string
  username: string
  avatarKey: string | null
  /** Short-lived presigned GET for the avatar object, resolved on the server. */
  avatarUrl: string | null
}

/** Avatars shown inline; the rest collapse into a "+N" popover. */
const VISIBLE = 5

// Placement maths (and the reasoning behind it) live in ./memberStackLayout.
const STAGGER_MS = 20
const DURATION_MS = 180

/**
 * Jira-style member stack in the project header, in two stages:
 *
 *  1. Collapsed, the avatars overlap and the whole stack is one control — the
 *     first click (or keyboard focus) blooms them apart.
 *  2. Once separated, each avatar toggles that person into/out of the
 *     `?assigneeId=` filter that already drives the board and backlog (see
 *     TaskFilters' assignee picker — same repeatable param, so the two stay in
 *     sync and a saved view captures either).
 *
 * Splitting it this way keeps a click on overlapping avatars from being a
 * coin-flip over which face you actually hit.
 *
 * `me` is a portable alias TaskFilters can write for the signed-in user, so a
 * member is "selected" if the URL carries their id OR `me` when they are that
 * user — see features/tasks/assigneeFilter.ts.
 */
export function MemberFilterStack({
  members,
  currentUserId,
}: {
  members: FilterMember[]
  currentUserId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [overflowOpen, setOverflowOpen] = React.useState(false)
  const [reducedMotion, setReducedMotion] = React.useState(false)

  // Delays are inline (one per index), so they can't be overridden by a
  // `motion-reduce:` class — the query has to be read here instead.
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setReducedMotion(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  // Collapse when focus or a click lands outside. Only armed while open, so
  // the common (collapsed) case carries no document-level listeners.
  React.useEffect(() => {
    if (!expanded) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) return
      // The overflow popover portals outside the root — don't collapse under it.
      if (
        target instanceof Element &&
        target.closest("[data-slot=popover-content]")
      ) {
        return
      }
      setExpanded(false)
      setOverflowOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      setExpanded(false)
      setOverflowOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [expanded])

  const selectedValues = searchParams.getAll("assigneeId")
  const anySelected = selectedValues.length > 0
  const isSelected = (id: string) =>
    isAssigneeSelected(selectedValues, id, currentUserId)

  function toggle(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    const next = toggleAssigneeValue(
      params.getAll("assigneeId"),
      id,
      currentUserId,
    )
    params.delete("assigneeId")
    for (const v of next) params.append("assigneeId", v)
    // Pagination is filter-relative — a new filter invalidates the cursor.
    params.delete("cursor")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  // A project with no members has nothing to filter by — and would otherwise
  // compute a negative container width below.
  if (members.length === 0) return null

  const visible = members.slice(0, VISIBLE)
  const overflow = members.slice(VISIBLE)
  const overflowSelectedCount = overflow.filter((m) => isSelected(m.id)).length

  // The "+N" chip is a positioned sibling of the avatars, so it counts here.
  const chipCount = visible.length + (overflow.length > 0 ? 1 : 0)

  function chipStyle(index: number): React.CSSProperties {
    return {
      transform: `translateX(${chipOffset(index, expanded, chipCount)}px)`,
      transitionDuration: reducedMotion ? "0ms" : `${DURATION_MS}ms`,
      // Bloom outward from the left-most face rather than all at once.
      transitionDelay: reducedMotion ? "0ms" : `${index * STAGGER_MS}ms`,
    }
  }

  // Dimming only reads as "filtered" once something is actually selected;
  // with no filter every avatar stays at full strength.
  const avatarClass = (selected: boolean) =>
    cn(
      "rounded-full ring-2",
      selected
        ? "ring-primary"
        : "ring-background hover:opacity-100 focus-visible:opacity-100",
      anySelected && !selected && "opacity-50",
    )

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Filter by assignee"
      className="relative h-6 shrink-0"
      style={{ width: collapsedWidth(chipCount) }}
      // Tabbing in from the header separates the avatars, so keyboard users
      // never have to "click to expand" before they can pick someone.
      onFocus={() => setExpanded(true)}
    >
      {/*
        Expanding grows leftward, which can reach across a long project title.
        A backdrop turns that from a collision into a deliberate floating
        layer — and gives the separated faces something to sit on.
      */}
      {expanded ? (
        <span
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 rounded-full border border-border bg-surface-raised/95 shadow-lg"
          style={{ right: -6, width: expandedWidth(chipCount) + 12, height: 36 }}
        />
      ) : null}

      {visible.map((member, index) => {
        const selected = isSelected(member.id)
        // Collapsed, the stack is one control: only the first chip is
        // reachable and it describes the expand action, so a screen reader
        // isn't read five identical buttons stacked on top of each other.
        const isCollapsedTrigger = !expanded && index === 0
        const inert = !expanded && index !== 0
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => (expanded ? toggle(member.id) : setExpanded(true))}
            tabIndex={inert ? -1 : undefined}
            aria-hidden={inert || undefined}
            aria-expanded={isCollapsedTrigger ? false : undefined}
            aria-pressed={expanded ? selected : undefined}
            aria-label={
              isCollapsedTrigger
                ? `Show ${members.length} project members to filter by assignee`
                : selected
                  ? `Remove ${member.name} from the assignee filter`
                  : `Filter tasks assigned to ${member.name}`
            }
            style={{ ...chipStyle(index), zIndex: selected ? 20 : index }}
            className="absolute top-0 left-0 rounded-full outline-none transition-transform ease-out focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AssigneeAvatar
              user={member}
              avatarUrl={member.avatarUrl}
              className={avatarClass(selected)}
            />
          </button>
        )
      })}

      {overflow.length > 0 ? (
        <Popover
          open={expanded && overflowOpen}
          // Collapsed, the chip is part of the single expand control — the
          // popover must not open on that first click.
          onOpenChange={(next) => {
            if (!expanded) {
              setExpanded(true)
              return
            }
            setOverflowOpen(next)
          }}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                tabIndex={expanded ? undefined : -1}
                aria-hidden={expanded ? undefined : true}
                aria-label={`Show ${overflow.length} more members`}
                style={{
                  ...chipStyle(visible.length),
                  zIndex: overflowSelectedCount > 0 ? 20 : visible.length,
                }}
                className={cn(
                  "absolute top-0 left-0 flex size-6 items-center justify-center rounded-full border bg-surface-raised text-[10px] text-muted-foreground outline-none ring-2 transition-transform ease-out focus-visible:ring-ring",
                  overflowSelectedCount > 0
                    ? "border-primary text-foreground ring-primary"
                    : "border-border ring-background",
                )}
              />
            }
          >
            +{overflow.length}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <ul className="flex max-h-64 flex-col overflow-y-auto">
              {overflow.map((member) => {
                const selected = isSelected(member.id)
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => toggle(member.id)}
                      aria-pressed={selected}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <AssigneeAvatar
                        user={member}
                        avatarUrl={member.avatarUrl}
                        className="rounded-full"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {member.name}
                      </span>
                      {selected ? (
                        <Check
                          className="size-4 shrink-0 text-primary"
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}
