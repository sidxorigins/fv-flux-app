"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserStatus } from "@/generated/prisma/enums";

const STATUS_ITEMS: Record<string, string> = {
  ALL: "All statuses",
  INVITED: "Invited",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
};

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "INVITED", label: "Invited" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
] as const;

interface UsersToolbarProps {
  initialQuery: string;
  initialStatus: UserStatus | null;
}

/**
 * Search + status filter for the users table. Both drive URL params so the page
 * (a Server Component) refetches server-side. The text search is debounced so we
 * don't navigate on every keystroke; changing a filter resets pagination.
 */
export function UsersToolbar({ initialQuery, initialStatus }: UsersToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [value, setValue] = React.useState(initialQuery);
  const currentQuery = searchParams.get("q") ?? "";

  // Debounced push: only navigate once the typed value differs from the URL.
  React.useEffect(() => {
    if (value === currentQuery) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set("q", value.trim());
      else params.delete("q");
      params.delete("cursor");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, 300);
    return () => clearTimeout(t);
  }, [value, currentQuery, pathname, router, searchParams]);

  function onStatusChange(next: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (next && next !== "ALL") params.set("status", next);
    else params.delete("status");
    params.delete("cursor");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search by name, username, or email"
          aria-label="Search users"
          className="pl-8"
        />
      </div>

      <Select
        value={initialStatus ?? "ALL"}
        items={STATUS_ITEMS}
        onValueChange={onStatusChange}
      >
        <SelectTrigger aria-label="Filter by status" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
