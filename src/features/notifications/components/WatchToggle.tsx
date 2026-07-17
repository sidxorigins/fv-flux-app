"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { toggleWatchTask } from "../actions"

export interface WatchToggleProps {
  taskId: string
  watching: boolean
}

/**
 * Watch / unwatch a task. Watchers receive its follow-up notifications
 * (comments, status changes). Assignees and commenters are auto-subscribed;
 * this lets anyone else opt in or out.
 */
export function WatchToggle({ taskId, watching }: WatchToggleProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  function onToggle() {
    startTransition(async () => {
      const res = await toggleWatchTask(taskId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(res.data?.watching ? "Watching this task" : "Stopped watching")
      router.refresh()
    })
  }

  return (
    <Button
      variant={watching ? "secondary" : "outline"}
      size="sm"
      onClick={onToggle}
      disabled={isPending}
      aria-pressed={watching}
    >
      {watching ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
      {watching ? "Watching" : "Watch"}
    </Button>
  )
}
