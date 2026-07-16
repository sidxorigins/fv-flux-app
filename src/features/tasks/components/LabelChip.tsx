import type { Label } from "@/generated/prisma/client"

import { cn } from "@/lib/utils"

/**
 * Small, calm label chip: the user-picked `label.color` only tints the dot
 * (inline style — it's data, not a design token); the chip itself stays in
 * muted text with a hairline border so the board never turns into confetti.
 */
export function LabelChip({
  label,
  className,
}: {
  label: Label
  className?: string
}) {
  return (
    <span
      data-slot="label-chip"
      className={cn(
        "inline-flex h-5 min-w-0 items-center gap-1 rounded-full border border-border px-1.5 text-[11px] text-muted-foreground",
        className
      )}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
        aria-hidden
      />
      <span className="truncate">{label.name}</span>
    </span>
  )
}
