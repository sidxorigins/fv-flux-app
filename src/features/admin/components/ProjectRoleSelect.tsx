"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProjectRole } from "@/generated/prisma/enums";

import { PROJECT_ROLE_LABELS, PROJECT_ROLE_OPTIONS } from "./display";

interface ProjectRoleSelectProps {
  value: ProjectRole;
  onValueChange: (role: ProjectRole) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  "aria-label"?: string;
}

/** Small controlled Select for a project role — trigger shows the role label. */
export function ProjectRoleSelect({
  value,
  onValueChange,
  disabled,
  size = "sm",
  "aria-label": ariaLabel = "Project role",
}: ProjectRoleSelectProps) {
  return (
    <Select
      value={value}
      items={PROJECT_ROLE_LABELS}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) onValueChange(next as ProjectRole);
      }}
    >
      <SelectTrigger size={size} aria-label={ariaLabel} className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROJECT_ROLE_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
