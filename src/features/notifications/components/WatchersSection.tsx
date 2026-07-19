"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Plus, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { User } from "@/generated/prisma/client"
import { AssigneeAvatar } from "@/features/tasks/components/AssigneeAvatar"

import { addTaskWatcher, removeTaskWatcher } from "../actions"
import type { TaskWatcherItem } from "../queries"

type Member = Pick<User, "id" | "name" | "username" | "avatarKey">

export interface WatchersSectionProps {
  taskId: string
  watchers: TaskWatcherItem[]
  members: Member[]
  canManage: boolean
  currentUserId: string
}

export function WatchersSection({
  taskId,
  watchers,
  members,
  canManage,
  currentUserId,
}: WatchersSectionProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [open, setOpen] = React.useState(false)

  const watcherIds = new Set(watchers.map((w) => w.id))
  const addable = members.filter((m) => !watcherIds.has(m.id))

  function onAdd(userId: string) {
    setOpen(false)
    startTransition(async () => {
      const res = await addTaskWatcher({ taskId, userId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Watcher added")
      router.refresh()
    })
  }

  function onRemove(userId: string) {
    startTransition(async () => {
      const res = await removeTaskWatcher({ taskId, userId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {watchers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No watchers yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {watchers.map((w) => {
            const removable = canManage || w.id === currentUserId
            return (
              <li key={w.id} className="flex items-center gap-2">
                <AssigneeAvatar user={w} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {w.name}{" "}
                  <span className="text-muted-foreground">@{w.username}</span>
                </span>
                {removable ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground hover:text-danger"
                    onClick={() => onRemove(w.id)}
                    disabled={isPending}
                    aria-label={`Remove ${w.name} as watcher`}
                  >
                    <X aria-hidden />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {canManage ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                disabled={isPending || addable.length === 0}
                aria-label="Add watcher"
              />
            }
          >
            <Plus className="size-3" aria-hidden />
            Add watcher
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            {addable.length > 0 ? (
              <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                {addable.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => onAdd(m.id)}
                      disabled={isPending}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-foreground hover:bg-surface-raised"
                    >
                      <AssigneeAvatar user={m} />
                      <span className="min-w-0 flex-1 truncate">
                        {m.name}{" "}
                        <span className="text-muted-foreground">
                          @{m.username}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1.5 py-1 text-xs text-muted-foreground">
                Everyone on this project is already watching.
              </p>
            )}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}
