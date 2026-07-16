import Link from "next/link";
import { LogOut, Search, UserRound } from "lucide-react";

import { signOut } from "@/lib/auth";
import { getMyProfile } from "@/features/users/queries";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TopbarProps {
  /** Page-context slot (breadcrumbs / page title), rendered on the left. */
  children?: React.ReactNode;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Inline Server Action: sign out and land on /login. Defined here (rather
 * than in features/users/actions.ts) since it's auth, not profile-editing —
 * `signOut` already invalidates the session; the redirect is what actually
 * throws and propagates, so there's nothing else to handle here.
 */
async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

/** Glass topbar (server component). */
export async function Topbar({ children }: TopbarProps) {
  const profile = await getMyProfile();

  return (
    <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6 lg:px-8">
      <div className="glass flex h-14 items-center justify-between gap-4 px-3 sm:px-4">
        <div className="min-w-0 flex-1">{children}</div>

        <div className="flex shrink-0 items-center gap-2">
          {/* TODO: wire up a real command palette (Cmd+K) — non-functional affordance for now. */}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Search"
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <Search aria-hidden />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground sm:inline-block">
              ⌘K
            </kbd>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Account menu"
                  className="rounded-full outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
                />
              }
            >
              <Avatar>
                {profile.avatarUrl ? (
                  <AvatarImage src={profile.avatarUrl} alt="" />
                ) : null}
                <AvatarFallback className="bg-surface-raised text-xs font-medium text-foreground">
                  {initialsFor(profile.name)}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {profile.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  @{profile.username}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {profile.email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/profile" />}>
                <UserRound aria-hidden />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={signOutAction}>
                <LogOut aria-hidden />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
