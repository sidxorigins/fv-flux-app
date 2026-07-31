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

/**
 * Jira-style member stack in the project header: each avatar toggles that
 * person into/out of the `?assigneeId=` filter that already drives the board
 * and backlog (see TaskFilters' assignee picker — same repeatable param, so
 * the two stay in sync and a saved view captures either).
 *
 * `me` is a portable alias TaskFilters can write for the signed-in user, so a
 * member is "selected" if the URL carries their id OR `me` when they are that
 * user — and toggling off has to clear both spellings.
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
  const [overflowOpen, setOverflowOpen] = React.useState(false)

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

  const visible = members.slice(0, VISIBLE)
  const overflow = members.slice(VISIBLE)
  const overflowSelectedCount = overflow.filter((m) => isSelected(m.id)).length

  // Dimming only reads as "filtered" once something is actually selected;
  // with no filter every avatar stays at full strength.
  const avatarClass = (selected: boolean) =>
    cn(
      "rounded-full ring-2 transition-opacity duration-150 motion-reduce:transition-none",
      selected
        ? "z-10 ring-primary"
        : "ring-background hover:opacity-100 focus-visible:opacity-100",
      anySelected && !selected && "opacity-50",
    )

  return (
    <div className="flex -space-x-2" role="group" aria-label="Filter by assignee">
      {visible.map((member) => {
        const selected = isSelected(member.id)
        return (
          <button
            key={member.id}
            type="button"
            onClick={() => toggle(member.id)}
            aria-pressed={selected}
            aria-label={
              selected
                ? `Remove ${member.name} from the assignee filter`
                : `Filter tasks assigned to ${member.name}`
            }
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={`Show ${overflow.length} more members`}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border bg-surface-raised text-[10px] text-muted-foreground outline-none ring-2 focus-visible:ring-ring",
                  overflowSelectedCount > 0
                    ? "z-10 border-primary ring-primary text-foreground"
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
                        <Check className="size-4 shrink-0 text-primary" aria-hidden />
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
