"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { setWallBoardVisibility } from "@/features/admin/actions";
import type { WallBoardUser } from "@/features/admin/display/queries";

// Client component: each row toggles independently and optimistically, so
// flipping several people in a row doesn't mean waiting on a round-trip each
// time. A failed action rolls that row back and says why.

export function WallBoardUserList({ users }: { users: WallBoardUser[] }) {
  const router = useRouter();
  // Optimistic overrides, keyed by user id.
  //
  // Each records the server value it replaced (`from`). Once the server moves
  // past that value the override is stale and ignored, so it expires on its own
  // as the refresh lands — no effect, no cascading renders, and a change made
  // elsewhere can never be masked by a leftover optimistic value.
  const [overrides, setOverrides] = useState<
    Record<string, { value: boolean; from: boolean }>
  >({});
  // Which rows have a request in flight. Per-row, NOT a shared useTransition:
  // one pending toggle must not disable every other switch on the page.
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const visibleOf = (u: WallBoardUser) => {
    const override = overrides[u.id];
    if (!override || override.from !== u.showOnWallBoard) return u.showOnWallBoard;
    return override.value;
  };
  const shownCount = users.filter(visibleOf).length;

  async function toggle(user: WallBoardUser) {
    if (busy[user.id]) return;

    const current = visibleOf(user);
    const next = !current;
    setOverrides((o) => ({
      ...o,
      [user.id]: { value: next, from: user.showOnWallBoard },
    }));
    setBusy((b) => ({ ...b, [user.id]: true }));

    try {
      const result = await setWallBoardVisibility({ userId: user.id, visible: next });
      if (!result.ok) {
        // Roll back this row only — other in-flight toggles are unaffected.
        setOverrides((o) => {
          const rolled = { ...o };
          delete rolled[user.id];
          return rolled;
        });
        toast.error(result.error ?? "Couldn't update the wall board.");
        return;
      }
      router.refresh();
    } finally {
      setBusy((b) => {
        const nextBusy = { ...b };
        delete nextBusy[user.id];
        return nextBusy;
      });
    }
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

              {/* The shared shadcn/base-ui primitive, not a hand-rolled button:
                  it already handles the thumb, focus ring, disabled state and
                  dark-mode thumb colour, and it keeps this switch identical to
                  the ones on /admin/teams and /explore. */}
              <Switch
                checked={visible}
                disabled={busy[user.id] ?? false}
                onCheckedChange={() => void toggle(user)}
                aria-label={`Show ${user.name} on the wall board`}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
