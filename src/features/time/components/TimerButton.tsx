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

// Mismatch-free "mounted on client" signal (server=false) without a
// setState-in-effect — same idiom as TimeAgo.tsx. Lets the live clock upgrade
// only after hydration so SSR and the first client render agree.
const noopSubscribe = () => () => {}
const getMounted = () => true
const getMountedServer = () => false

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

  const mounted = React.useSyncExternalStore(noopSubscribe, getMounted, getMountedServer)
  // 1s re-render tick — the setState lives in the interval CALLBACK, never
  // synchronously in the effect body.
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    if (!runningHere || !running) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [runningHere, running])

  function onStart() {
    startTransition(async () => {
      const res = await startTimer({ taskId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      if (res.data?.stoppedTaskKey) toast.info(`Stopped timer on ${res.data.stoppedTaskKey}`)
      toast.success("Timer started")
      router.refresh()
    })
  }
  function onStop() {
    startTransition(async () => {
      const res = await stopTimer()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Timer stopped")
      router.refresh()
    })
  }

  if (runningHere && running) {
    const elapsed = mounted ? new Date().getTime() - new Date(running.startedAt).getTime() : 0
    return (
      <Button size="sm" variant="secondary" onClick={onStop} disabled={isPending} aria-label="Stop timer">
        <Square aria-hidden />
        <span className="tabular-nums" suppressHydrationWarning>{hms(elapsed)}</span>
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
