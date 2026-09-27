import { Crown } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { CrewUser } from "../queries";

export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * Small avatar for a crew member. `avatarUrl` is a short-lived presigned URL
 * resolved server-side — never the raw R2 key. `owner` adds a crown badge and
 * `role` shows in the tooltip ("Camera A").
 */
export function CrewAvatar({
  user,
  role,
  owner = false,
  size = "sm",
  className,
}: {
  user: CrewUser;
  role?: string | null;
  owner?: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  const label = [user.name, owner ? "owner" : null, role].filter(Boolean).join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("relative inline-flex shrink-0", className)} />}>
        <Avatar size={size} className={cn(owner && "ring-2 ring-primary/70")}>
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
          <AvatarFallback className={cn("font-medium", size === "sm" ? "text-[10px]" : "text-xs")}>
            {initialsOf(user.name)}
          </AvatarFallback>
        </Avatar>
        {owner ? (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Crown className="size-2.5" />
          </span>
        ) : null}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
