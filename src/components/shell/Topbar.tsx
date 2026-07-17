import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";

import { auth, signOut } from "@/lib/auth";
import { getMyProfile } from "@/features/users/queries";
import {
  getMyNotifications,
  getUnreadNotificationCount,
} from "@/features/notifications/queries";
import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import { CommandPalette } from "./CommandPalette";
import { MobileNav } from "./MobileNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
  const [profile, session, notifications, unreadCount] = await Promise.all([
    getMyProfile(),
    auth(),
    getMyNotifications(),
    getUnreadNotificationCount(),
  ]);
  const isAdmin = session?.user?.globalRole === "ADMIN";

  return (
    <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6 lg:px-8">
      <div className="glass flex h-14 items-center justify-between gap-4 px-3 sm:px-4">
        <MobileNav isAdmin={isAdmin} unreadCount={unreadCount} />
        <div className="min-w-0 flex-1">{children}</div>

        <div className="flex shrink-0 items-center gap-2">
          <CommandPalette />
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
          />

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
              {/* Base UI requires GroupLabel to live inside a Group. */}
              <DropdownMenuGroup>
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
              </DropdownMenuGroup>
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
