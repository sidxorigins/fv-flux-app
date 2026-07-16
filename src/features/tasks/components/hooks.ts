"use client"

import * as React from "react"

const emptySubscribe = () => () => {}

function subscribeToReducedMotion(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)")
  query.addEventListener("change", callback)
  return () => query.removeEventListener("change", callback)
}

export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  )
}

// Stable per-page-load clock so useSyncExternalStore snapshots don't change
// identity between renders (day-level granularity is all overdue checks need).
let clientNow: Date | null = null
function getClientNow(): Date | null {
  if (clientNow === null) clientNow = new Date()
  return clientNow
}
const getServerNow = (): Date | null => null

/**
 * Reference clock for overdue highlighting. When the caller doesn't provide
 * one, a stable `Date` is resolved on the client only — the server render and
 * the hydration render both see `null`, so there is no hydration mismatch;
 * the danger tint upgrades right after paint.
 */
export function useClientNow(now?: Date): Date | null {
  const fallback = React.useSyncExternalStore(
    emptySubscribe,
    getClientNow,
    getServerNow
  )
  return now ?? fallback
}
