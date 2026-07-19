"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { AssigneeAvatar } from "@/features/tasks/components/AssigneeAvatar"
import { deleteTimeEntry } from "../actions"
import { formatMinutes } from "../format"
import type { RunningTimer, TaskTime } from "../queries"
import { TimerButton } from "./TimerButton"

export interface TaskTimeSectionProps {
  taskId: string
  time: TaskTime
  running: RunningTimer | null
  /** MEMBER+ on this project — may log time. */
  canLog: boolean
  currentUserId: string
}

export function TaskTimeSection({ taskId, time, running, canLog, currentUserId }: TaskTimeSectionProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function onDelete(id: string) {
    startTransition(async () => {
      const res = await deleteTimeEntry({ id })
      if (!res.ok) return toast.error(res.error)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {formatMinutes(time.totalMinutes)}
          </span>
          <span className="text-xs text-muted-foreground">
            total · {formatMinutes(time.myMinutes)} by you
          </span>
        </div>
        {canLog ? <TimerButton taskId={taskId} running={running} /> : null}
      </div>

      {time.perUser ? (
        <ul className="flex flex-col gap-1.5">
          {time.perUser.map((r) => (
            <li key={r.user.id} className="flex items-center gap-2 text-sm">
              <AssigneeAvatar user={r.user} />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {r.user.name}{" "}
                <span className="text-muted-foreground">@{r.user.username}</span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatMinutes(r.minutes)}
              </span>
            </li>
          ))}
          {time.perUser.length === 0 ? (
            <li className="text-sm text-muted-foreground">No time logged yet.</li>
          ) : null}
        </ul>
      ) : null}

      {time.entries.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-border pt-2">
          {time.entries.map((e) => {
            const canRemove = time.canManage || e.user.id === currentUserId
            return (
              <li key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums text-foreground">{formatMinutes(e.minutes)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {e.user.name} · {new Date(e.startedAt).toLocaleDateString()}
                </span>
                {canRemove ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => onDelete(e.id)}
                    disabled={isPending}
                    aria-label={`Delete ${formatMinutes(e.minutes)} entry`}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No time logged yet.</p>
      )}
    </div>
  )
}
