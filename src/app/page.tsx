import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LetterRain, ScrambledTitle } from "@/components/ui/raining-letters";

/**
 * Public landing page — the only unauthenticated page besides the auth flows.
 * Signed-in users skip straight to their dashboard.
 *
 * A single viewport, no scroll: raining glyphs behind the Flux wordmark and
 * its scramble-decoding tagline, nav on top, footer pinned to the base.
 * Everything animated is client-side garnish; copy, CTAs and footer are
 * server-rendered.
 */

const HERO_PHRASES = [
  "Work in motion.",
  "Plan the sprint.",
  "Move the board.",
  "Ship the work.",
];

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="relative flex h-svh min-h-[34rem] flex-col overflow-hidden">
      <LetterRain />

      {/* Nav overlays the rain */}
      <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-xl font-bold tracking-tight text-foreground">
          Flux
          <span aria-hidden className="text-primary">
            .
          </span>
        </span>
        <Button size="sm" nativeButton={false} render={<Link href="/login" />}>
          Sign in
        </Button>
      </header>

      {/* Hero content — centred in the remaining viewport */}
      <div className="relative z-20 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-7xl leading-none font-bold tracking-tight text-foreground sm:text-9xl">
          Flux
          <span aria-hidden className="text-primary">
            .
          </span>
        </h1>

        <ScrambledTitle
          as="p"
          phrases={HERO_PHRASES}
          label="Work in motion."
          className="min-h-[1.4em] text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
        />

        <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Flux is where Foodverse teams plan projects, move tasks across the
          board and keep every change on the record — one shared view of work
          as it happens.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            Sign in
            <ArrowRight aria-hidden />
          </Button>
          <span className="text-sm text-muted-foreground">
            No account? Access is by admin invite.
          </span>
        </div>
      </div>

      {/* Footer — pinned to the base of the hero, rain behind it */}
      <footer className="relative z-20 border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 py-5 sm:flex-row">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Powered by</span>
            <a
              href="https://foodverse.io"
              rel="noreferrer"
              aria-label="Foodverse"
              className="transition-opacity duration-150 hover:opacity-80"
            >
              <Image
                src="/foodverse-logo.png"
                alt="Foodverse — Face of Food"
                width={144}
                height={91}
                className="h-auto w-[72px]"
              />
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} ICCA · flux.foodverse.io
          </p>
        </div>
      </footer>
    </div>
  );
}
