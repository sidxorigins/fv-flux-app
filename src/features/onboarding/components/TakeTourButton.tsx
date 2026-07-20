"use client";

import { HelpCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { tourStore } from "../useTour";

/**
 * Replays the tour. The tour's anchors live on /dashboard, so if we're elsewhere
 * we route there first; the GuidedTour instance on the dashboard reacts to the
 * shared store and starts on mount.
 */
export function TakeTourButton() {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <button
      type="button"
      aria-label="Take a tour"
      title="Take a tour"
      onClick={() => {
        tourStore.openTour();
        if (pathname !== "/dashboard") router.push("/dashboard");
      }}
      className="rounded-full p-2 text-muted-foreground outline-none transition-colors duration-150 hover:bg-surface-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
    >
      <HelpCircle className="size-5" aria-hidden />
    </button>
  );
}
