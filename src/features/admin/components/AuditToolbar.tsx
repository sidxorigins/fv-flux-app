"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter } from "lucide-react";

import { Input } from "@/components/ui/input";

interface AuditToolbarProps {
  initialAction: string;
}

/**
 * Free-text filter on the audit `action` string (e.g. "invite", "role_changed").
 * Debounced and URL-param driven so the audit page re-queries server-side.
 */
export function AuditToolbar({ initialAction }: AuditToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [value, setValue] = React.useState(initialAction);
  const current = searchParams.get("action") ?? "";

  React.useEffect(() => {
    if (value === current) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set("action", value.trim());
      else params.delete("action");
      params.delete("cursor");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, 300);
    return () => clearTimeout(t);
  }, [value, current, pathname, router, searchParams]);

  return (
    <div className="relative max-w-xs">
      <Filter
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Filter by action (e.g. invite.sent)"
        aria-label="Filter audit log by action"
        className="pl-8 font-mono text-xs"
      />
    </div>
  );
}
