"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keeps the wall board current without a full page reload.
//
// router.refresh() re-runs the Server Component and patches the tree in place,
// so the screen never flashes white and scroll/DOM state is preserved — a hard
// location.reload() on a TV is visibly jarring every minute.
//
// Also holds a Wake Lock so the mini PC doesn't blank the screen. The API is
// only available over HTTPS/localhost and can be rejected, so every call is
// guarded; failure just means the OS screensaver settings do the work instead.

export function DisplayRefresher({
  intervalSeconds = 60,
}: {
  intervalSeconds?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalSeconds * 1000);
    return () => clearInterval(id);
  }, [router, intervalSeconds]);

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
