"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Play, Square } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { startTimer, stopTimer } from "../actions"
import type { RunningTimer } from "../queries"

function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

export interface TimerButtonProps {
  taskId: string
  /** The signed-in user's running timer anywhere, or null. */
  running: RunningTimer | null
}

/** Start / stop / switch the current user's timer for THIS task, with a live clock. */
export function TimerButton({ taskId, running }: TimerButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const runningHere = running?.taskId === taskId

  // Live-tick elapsed only while the timer runs on this task.
  const [now, setNow] = React.useState<number>(() => (runningHere ? Date.now() : 0))
  React.useEffect(() => {
    if (!runningHere || !running) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runningHere, running])

  function onStart() {
    startTransition(async () => {
      const res = await startTimer({ taskId })
      if (!res.ok) return toast.error(res.error)
      if (res.data?.stoppedTaskKey) toast.info(`Stopped timer on ${res.data.stoppedTaskKey}`)
      toast.success("Timer started")
      router.refresh()
    })
  }
  function onStop() {
    startTransition(async () => {
      const res = await stopTimer()
      if (!res.ok) return toast.error(res.error)
      toast.success("Timer stopped")
      router.refresh()
    })
  }

  if (runningHere && running) {
    const elapsed = now ? now - new Date(running.startedAt).getTime() : 0
    return (
      <Button size="sm" variant="secondary" onClick={onStop} disabled={isPending} aria-label="Stop timer">
        <Square aria-hidden />
        <span className="tabular-nums">{hms(elapsed)}</span>
      </Button>
    )
  }
  return (
    <Button size="sm" variant="outline" onClick={onStart} disabled={isPending} aria-label="Start timer">
      <Play aria-hidden />
      {running ? "Switch timer here" : "Start timer"}
    </Button>
  )
}
