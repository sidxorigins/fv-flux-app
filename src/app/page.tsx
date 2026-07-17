import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileText, ScrollText, UsersRound } from "lucide-react";

import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LetterRain, ScrambledTitle } from "@/components/ui/raining-letters";

/**
 * Public landing page — the only unauthenticated page besides the auth flows.
 * Signed-in users skip straight to their dashboard.
 *
 * Hero is the 21st.dev "raining letters" treatment re-themed to the Flux
 * tokens: falling glyphs with the occasional orange flicker behind a
 * scramble-decoding headline. Everything animated is client-side garnish;
 * the copy, CTAs, features and footer are server-rendered.
 */

const HERO_PHRASES = [
  "Work in motion.",
  "Plan the sprint.",
  "Move the board.",
  "Ship the work.",
  "Flux.",
];

const FEATURES = [
  {
    icon: UsersRound,
    title: "Per-project roles",
    body: "Managers run their projects, members move the work, viewers stay read-only. Access is granted per project, never assumed.",
  },
  {
    icon: FileText,
    title: "Tasks that carry context",
    body: "Rich descriptions, comments, file attachments, subtasks and labels — everything about a task lives on the task.",
  },
  {
    icon: ScrollText,
    title: "Every change on the record",
    body: "Status moves, reassignments and role grants are logged automatically. The history is always one click away.",
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Hero — full viewport, raining glyphs behind the decoding headline */}
      <section className="relative flex h-svh min-h-[36rem] flex-col overflow-hidden">
        <LetterRain />

        {/* Nav overlays the rain */}
        <header className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <span className="text-xl font-bold tracking-tight text-foreground">
            Flux
            <span aria-hidden className="text-primary">
              .
            </span>
          </span>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            Sign in
          </Button>
        </header>

        <div className="relative z-20 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-6 px-6 pb-20 text-center">
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Internal · Invite-only
          </p>

          <ScrambledTitle
            phrases={HERO_PHRASES}
            label="Flux — work in motion"
            className="min-h-[2.4em] text-5xl leading-tight font-bold tracking-tight text-foreground sm:min-h-[1.2em] sm:text-7xl"
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

        {/* Fade the rain out into the content below */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-40 bg-gradient-to-b from-transparent to-background"
        />
      </section>

      {/* Features — quiet, solid surface */}
      <main className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-4 py-16 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-5"
            >
              <Icon aria-hidden className="size-5 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer — powered by Foodverse */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-6 px-6 py-8 sm:flex-row">
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
                className="h-auto w-[86px]"
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
