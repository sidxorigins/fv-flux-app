"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/invites", label: "Invites" },
  { href: "/admin/projects", label: "Project access" },
  { href: "/admin/audit", label: "Audit" },
] as const;

/**
 * Horizontal, tabs-style subnav for the admin area. Link-based (not the Tabs
 * primitive) so each section is its own route/RSC. Active state comes from the
 * pathname — the only reason this is a client component.
 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
      className="flex items-center gap-1 border-b border-border"
    >
      {TABS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px inline-flex items-center border-b-2 px-3 py-2 text-sm font-medium",
              "transition-colors duration-150 motion-reduce:transition-none",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
