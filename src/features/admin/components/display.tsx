// Shared display metadata for the admin area — role/status labels, functional
// colours, and small badge components. No "use client": these are pure
// presentation and render in both Server and Client Components.
//
// Functional colours follow CLAUDE.md "Look & Feel": status/role chips use the
// functional tokens (success/warning/info/danger/muted), never orange fills.

import { cn } from "@/lib/utils";
import type { GlobalRole, ProjectRole, UserStatus } from "@/generated/prisma/enums";

type ChipMeta = { label: string; chipClass: string; dotClass: string };

export const GLOBAL_ROLE_META: Record<GlobalRole, ChipMeta> = {
  ADMIN: {
    label: "Admin",
    chipClass: "bg-primary/10 text-primary",
    dotClass: "bg-primary",
  },
  USER: {
    label: "User",
    chipClass: "bg-muted-foreground/10 text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
};

export const USER_STATUS_META: Record<UserStatus, ChipMeta> = {
  INVITED: {
    label: "Invited",
    chipClass: "bg-muted-foreground/10 text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
  ACTIVE: {
    label: "Active",
    chipClass: "bg-success/10 text-success",
    dotClass: "bg-success",
  },
  SUSPENDED: {
    label: "Suspended",
    chipClass: "bg-danger/10 text-danger",
    dotClass: "bg-danger",
  },
};

export const PROJECT_ROLE_META: Record<ProjectRole, ChipMeta> = {
  MANAGER: {
    label: "Manager",
    chipClass: "bg-warning/10 text-warning",
    dotClass: "bg-warning",
  },
  MEMBER: {
    label: "Member",
    chipClass: "bg-info/10 text-info",
    dotClass: "bg-info",
  },
  VIEWER: {
    label: "Viewer",
    chipClass: "bg-muted-foreground/10 text-muted-foreground",
    dotClass: "bg-muted-foreground",
  },
};

// Options + label maps reused by <Select> controls (Base UI `items` wants a
// value→label record; the trigger shows the label of the selected value).
export const GLOBAL_ROLE_OPTIONS = [
  { value: "USER", label: "User" },
  { value: "ADMIN", label: "Admin" },
] as const satisfies ReadonlyArray<{ value: GlobalRole; label: string }>;

export const PROJECT_ROLE_OPTIONS = [
  { value: "MANAGER", label: "Manager" },
  { value: "MEMBER", label: "Member" },
  { value: "VIEWER", label: "Viewer" },
] as const satisfies ReadonlyArray<{ value: ProjectRole; label: string }>;

export const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = {
  ADMIN: "Admin",
  USER: "User",
};

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  MANAGER: "Manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

function Chip({ meta, className }: { meta: ChipMeta; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap",
        meta.chipClass,
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dotClass)} aria-hidden />
      {meta.label}
    </span>
  );
}

export function GlobalRoleBadge({ role }: { role: GlobalRole }) {
  return <Chip meta={GLOBAL_ROLE_META[role]} />;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <Chip meta={USER_STATUS_META[status]} />;
}

export function ProjectRoleBadge({ role }: { role: ProjectRole }) {
  return <Chip meta={PROJECT_ROLE_META[role]} />;
}

/** Deterministic two-letter initials for avatar fallbacks. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
