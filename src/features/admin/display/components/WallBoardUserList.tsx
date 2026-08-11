"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setWallBoardVisibility } from "@/features/admin/actions";
import type { WallBoardUser } from "@/features/admin/display/queries";
import { cn } from "@/lib/utils";

// Client component: each row toggles independently and optimistically, so
// flipping several people in a row doesn't mean waiting on a round-trip each
// time. A failed action rolls that row back and says why.

export function WallBoardUserList({ users }: { users: WallBoardUser[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Optimistic overrides, keyed by user id. Absent = use the server value.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const visibleOf = (u: WallBoardUser) => overrides[u.id] ?? u.showOnWallBoard;
  const shownCount = users.filter(visibleOf).length;

  function toggle(user: WallBoardUser) {
    const next = !visibleOf(user);
    setOverrides((o) => ({ ...o, [user.id]: next }));

    startTransition(async () => {
      const result = await setWallBoardVisibility({ userId: user.id, visible: next });
      if (!result.ok) {
        // Roll back this row only — other pending toggles stay as they are.
        setOverrides((o) => ({ ...o, [user.id]: !next }));
        toast.error(result.error ?? "Couldn't update the wall board.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {shownCount} of {users.length} shown on the wall board.
        </p>
        {shownCount > 15 ? (
          <p className="text-warning text-sm">
            The board fits 15 — the rest appear as &ldquo;+{shownCount - 15} more&rdquo;.
          </p>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2">
        {users.map((user) => {
          const visible = visibleOf(user);
          return (
            <li
              key={user.id}
              className="glass flex items-center justify-between gap-4 p-4"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-foreground truncate text-sm font-medium">
                  {user.name}
                </span>
                <span className="text-muted-foreground truncate font-mono text-xs">
                  @{user.username}
                  {user.globalRole !== "USER" ? ` · ${user.globalRole}` : ""}
                  {user.openTasks > 0 ? ` · ${user.openTasks} open` : " · no open tasks"}
                </span>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={visible}
                aria-label={`Show ${user.name} on the wall board`}
                disabled={pending}
                onClick={() => toggle(user)}
                className={cn(
                  "relative h-6 w-11 shrink-0 cursor-pointer rounded-full",
                  "transition-colors duration-150 motion-reduce:transition-none",
                  "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  visible ? "bg-primary" : "bg-surface-raised border-border border",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1 size-4 rounded-full transition-transform duration-150",
                    "motion-reduce:transition-none",
                    visible
                      ? "bg-primary-foreground translate-x-6"
                      : "bg-muted-foreground translate-x-1",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
