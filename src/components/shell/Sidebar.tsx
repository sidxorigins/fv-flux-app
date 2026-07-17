import { NavLinks } from "./NavLinks";

/**
 * Fixed glass sidebar (server component). The nav's active-link state lives
 * in the small `NavLinks` client child.
 */
// Below lg the sidebar is hidden and MobileNav (hamburger + sheet in the
// topbar) takes over navigation.
export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 p-3 pr-0 lg:block">
      <div className="glass flex h-full flex-col p-3">
        {/* Wordmark — typographic only, no image */}
        <div className="flex items-center gap-2 px-3 pt-2 pb-6">
          <span className="text-xl font-bold tracking-tight text-foreground">
            Flux
            <span aria-hidden className="text-primary">
              .
            </span>
          </span>
        </div>
        <NavLinks />
      </div>
    </aside>
  );
}
