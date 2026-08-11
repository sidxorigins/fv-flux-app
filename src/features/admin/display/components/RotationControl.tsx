"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setWallBoardRotation } from "@/features/admin/actions";
import { cn } from "@/lib/utils";

// How long each pane holds on the wall board.
//
// Presets rather than a free number input: this drives an office TV, and the
// useful range is narrow. A dropdown removes the chance of someone typing 2 and
// making the wall strobe, without needing validation messaging in the UI (the
// action still clamps server-side regardless).
const PRESETS = [10, 15, 20, 30, 45, 60, 90, 120] as const;

export function RotationControl({ seconds }: { seconds: number }) {
  const router = useRouter();
  const [value, setValue] = useState(seconds);
  const [saving, setSaving] = useState(false);

  async function choose(next: number) {
    if (next === value || saving) return;
    const previous = value;
    setValue(next);
    setSaving(true);

    try {
      const result = await setWallBoardRotation({ seconds: next });
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error ?? "Couldn't change the rotation speed.");
        return;
      }
      toast.success(`Each screen now holds for ${formatSeconds(next)}.`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-sm font-semibold">Rotation speed</h2>
        <p className="text-muted-foreground text-xs">
          How long each screen holds before switching. Applies to the wall board
          within a minute — no need to touch the TV.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => {
          const active = preset === value;
          return (
            <button
              key={preset}
              type="button"
              disabled={saving}
              aria-pressed={active}
              onClick={() => void choose(preset)}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium",
                "transition-colors duration-150 motion-reduce:transition-none",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
                "disabled:cursor-not-allowed disabled:opacity-60",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-raised text-muted-foreground hover:text-foreground",
              )}
            >
              {formatSeconds(preset)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function formatSeconds(value: number): string {
  if (value < 60) return `${value}s`;
  const minutes = value / 60;
  return Number.isInteger(minutes) ? `${minutes}m` : `${value}s`;
}
