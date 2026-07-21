"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavLinks } from "./NavLinks";

/**
 * Mobile navigation — hamburger in the topbar (below lg, where the sidebar
 * is hidden) opening a left sheet with the same NavLinks. Closes itself on
 * navigation so the destination page is immediately visible.
 */
export function MobileNav({
  isAdmin = false,
  showManager = false,
  unreadCount = 0,
}: {
  isAdmin?: boolean;
  showManager?: boolean;
  unreadCount?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            className="lg:hidden"
          />
        }
      >
        <Menu aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-64 p-3"
        // Close as soon as a nav link is tapped so the destination page is
        // immediately visible (event-driven — no pathname effect needed).
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        <SheetHeader className="p-0">
          <SheetTitle className="flex items-center px-3 pt-2 pb-4 text-xl font-bold tracking-tight text-foreground">
            Flux
            <span aria-hidden className="text-primary">
              .
            </span>
          </SheetTitle>
        </SheetHeader>
        <NavLinks isAdmin={isAdmin} showManager={showManager} unreadCount={unreadCount} />
      </SheetContent>
    </Sheet>
  );
}
