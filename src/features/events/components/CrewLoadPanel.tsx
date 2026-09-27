import { Users } from "lucide-react";

import type { DaySchedule } from "../queries";
import { CrewAvatar } from "./CrewAvatar";

/**
 * Who is carrying the day. One row per person who owns or is crewed on at
 * least one session, with their MUST FILM share — the coordinator's quick
 * check that nobody is double-booked or idle.
 */
export function CrewLoadPanel({ crewLoad, total }: { crewLoad: DaySchedule["crewLoad"]; total: number }) {
  return (
    <section aria-labelledby="crew-load-heading" className="glass flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 id="crew-load-heading" className="text-xs font-medium tracking-wider text-foreground uppercase">
          Crew today
        </h2>
        <Users aria-hidden className="size-4 text-foreground" />
      </div>
      {crewLoad.length === 0 ? (
        <p className="text-sm text-foreground">Nobody is assigned yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {crewLoad.map(({ user, sessions, mustFilm }) => {
            const pct = total > 0 ? Math.round((sessions / total) * 100) : 0;
            return (
              <li key={user.id} className="flex items-center gap-3">
                <CrewAvatar user={user} size="default" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
                    <span className="shrink-0 text-xs text-foreground tabular-nums">
                      {sessions} {sessions === 1 ? "session" : "sessions"}
                      {mustFilm > 0 ? <span className="text-danger"> · {mustFilm} must</span> : null}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-surface-raised" aria-hidden>
                    <div className="h-full rounded-full bg-info" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
