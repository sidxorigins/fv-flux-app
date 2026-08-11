import type { Metadata } from "next";

// Kiosk layout — deliberately OUTSIDE the (dashboard) route group so it
// inherits neither the glass sidebar nor the topbar. A wall board has no
// navigation: nobody clicks a television.
//
// `h-screen overflow-hidden` here is what makes the no-scroll guarantee hold;
// DisplayBoard divides that height with fr rows rather than stacking content
// that could overflow.

export const metadata: Metadata = {
  title: "Foodverse — Wall Board",
};

export default function DisplayLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="bg-background h-screen w-screen overflow-hidden">{children}</div>
  );
}
