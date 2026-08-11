"use client";

import { useEffect } from "react";

// Holds a screen Wake Lock so the mini PC driving the TV never blanks.
//
// Data refreshing lives in DisplayRotator, which fires it on every rotation so
// each incoming screen carries fresh numbers. This component does one thing.
//
// The Wake Lock API is only available over HTTPS/localhost and can be rejected,
// so every call is guarded; failure just means the OS screensaver settings do
// the work instead.

export function DisplayWakeLock() {

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (!("wakeLock" in navigator)) return;
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        lock = sentinel;
      } catch {
        // Denied or unsupported — not fatal, the board still renders.
      }
    };

    void acquire();

    // The OS drops the lock whenever the tab is backgrounded, so it has to be
    // re-acquired when the page becomes visible again or the screen sleeps
    // after the first switch away.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !lock) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);

  return null;
}
