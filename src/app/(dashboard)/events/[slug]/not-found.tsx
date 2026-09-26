import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function EventNotFound() {
  return (
    <div className="glass mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-3 px-8 py-12 text-center">
      <p className="text-base font-medium text-foreground">Event not found</p>
      <p className="text-sm text-muted-foreground">It may have been deleted or the link is wrong.</p>
      <Button variant="outline" size="sm" render={<Link href="/events" />}>
        Back to events
      </Button>
    </div>
  );
}
