"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

interface CursorPagerProps {
  /** Cursor for the next page, or null when there are no more rows. */
  nextCursor: string | null;
  /** True when the current view is already paged (a `cursor` param is present). */
  hasCursor: boolean;
}

/**
 * Forward-only cursor pagination. Cursor pagination can't cheaply walk backward,
 * so we offer "Next" (append the next cursor) and a "Start" reset when paged in —
 * honest about the tradeoff rather than faking bidirectional paging.
 */
export function CursorPager({ nextCursor, hasCursor }: CursorPagerProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!nextCursor && !hasCursor) return null;

  function hrefWith(cursor: string | null): string {
    const params = new URLSearchParams(searchParams.toString());
    if (cursor) params.set("cursor", cursor);
    else params.delete("cursor");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex items-center justify-between pt-2">
      <div>
        {hasCursor ? (
          <Button variant="ghost" size="sm" render={<Link href={hrefWith(null)} />}>
            <ArrowLeft />
            Start
          </Button>
        ) : (
          <span />
        )}
      </div>
      <div>
        {nextCursor ? (
          <Button variant="outline" size="sm" render={<Link href={hrefWith(nextCursor)} />}>
            Next
            <ArrowRight />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
