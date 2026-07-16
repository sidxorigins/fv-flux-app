"use client"

import { UserPlus } from "lucide-react"

import type { User } from "@/generated/prisma/client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type AssigneeUser = Pick<User, "id" | "name" | "username" | "avatarKey">

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  )
}

/**
 * Assignee avatar with an initials fallback and a name tooltip.
 * `avatarUrl` is a short-lived presigned URL resolved by the caller — the raw
 * R2 `avatarKey` is never used as an image source (see CLAUDE.md).
 * `user = null` renders the dashed "unassigned" placeholder.
 */
export function AssigneeAvatar({
  user,
  avatarUrl,
  className,
}: {
  user: AssigneeUser | null
  avatarUrl?: string | null
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={cn("inline-flex shrink-0", className)} />}
      >
        {user ? (
          <Avatar size="sm">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-[10px] font-medium">
              {initialsOf(user.name)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <span
            role="img"
            aria-label="Unassigned"
            className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
          >
            <UserPlus className="size-3" aria-hidden />
          </span>
        )}
        <span className="sr-only">
          {user ? `Assigned to ${user.name}` : "Unassigned"}
        </span>
      </TooltipTrigger>
      <TooltipContent>{user ? user.name : "Unassigned"}</TooltipContent>
    </Tooltip>
  )
}
