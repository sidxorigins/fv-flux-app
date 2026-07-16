import { Search } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

interface TopbarProps {
  /** Page-context slot (breadcrumbs / page title), rendered on the left. */
  children?: React.ReactNode;
}

/** Glass topbar (server component). */
export function Topbar({ children }: TopbarProps) {
  return (
    <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6 lg:px-8">
      <div className="glass flex h-14 items-center justify-between gap-4 px-3 sm:px-4">
        <div className="min-w-0 flex-1">{children}</div>

        <div className="flex shrink-0 items-center gap-2">
          {/* TODO: wire up a real command palette (Cmd+K) — non-functional affordance for now. */}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Search"
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <Search aria-hidden />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded-sm border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground sm:inline-block">
              ⌘K
            </kbd>
          </Button>

          {/* TODO: replace with the signed-in user's avatar + account menu once auth lands. */}
          <Avatar>
            <AvatarFallback className="bg-surface-raised text-xs font-medium text-foreground">
              FX
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
