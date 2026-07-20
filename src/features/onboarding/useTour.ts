"use client";
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

export const tourStore = {
  openTour() { if (!open) { open = true; emit(); } },
  closeTour() { if (open) { open = false; emit(); } },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  get() { return open; },
};

/** Reactive "is the tour open?" — server snapshot false (mismatch-free). */
export function useTourOpen(): boolean {
  return useSyncExternalStore(tourStore.subscribe, tourStore.get, () => false);
}
