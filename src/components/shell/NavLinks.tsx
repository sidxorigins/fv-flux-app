"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderKanban,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Shield,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "My Tasks", icon: ListTodo },
];

const ADMIN_NAV_ITEM: NavItem = { href: "/admin", label: "Admin", icon: Shield };

/**
 * Primary navigation — the only client piece of the sidebar (active state
 * needs the pathname). The Admin link shows only for global Admins (the route
 * is server-protected regardless — this just hides a link nobody else can use).
 * The Inbox link carries an unread-count badge. Micro-interactions are CSS
 * transitions only.
 */
export function NavLinks({
  isAdmin = false,
  unreadCount = 0,
}: {
  isAdmin?: boolean;
  unreadCount?: number;
}) {
  const pathname = usePathname();
  const items = isAdmin ? [...BASE_NAV_ITEMS, ADMIN_NAV_ITEM] : BASE_NAV_ITEMS;

  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const showBadge = href === "/inbox" && unreadCount > 0;

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
              "transition-colors duration-150 motion-reduce:transition-none",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-surface-raised/70 hover:text-foreground"
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="flex-1">{label}</span>
            {showBadge ? (
              <span
                aria-label={`${unreadCount} unread`}
                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular-nums"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
