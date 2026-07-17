import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileText, ScrollText, UsersRound } from "lucide-react";

import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

/**
 * Public landing page — the only unauthenticated page besides the auth flows.
 * Signed-in users skip straight to their dashboard. Server-rendered, zero
 * client JS: the one entrance fade is CSS-only and respects reduced motion.
 */

/** A card on the miniature board. Decorative — real keys from the seed data. */
interface MiniCard {
  taskKey: string;
  title: string;
  dot: string;
  dragging?: boolean;
}

interface MiniColumn {
  label: string;
  dot: string;
  cards: MiniCard[];
}

const MINI_BOARD: MiniColumn[] = [
  {
    label: "To Do",
    dot: "bg-muted-foreground",
    cards: [
      { taskKey: "FLUX-2", title: "Design the board layout", dot: "bg-info" },
      { taskKey: "FLUX-7", title: "Rich-text comments", dot: "bg-muted-foreground" },
    ],
  },
  {
    label: "In Progress",
    dot: "bg-info",
    cards: [
      { taskKey: "FLUX-1", title: "Auth with invite flow", dot: "bg-warning" },
      {
        taskKey: "FLUX-3",
        title: "Fix drag flicker on Safari",
        dot: "bg-danger",
        dragging: true,
      },
    ],
  },
  {
    label: "Done",
    dot: "bg-success",
    cards: [{ taskKey: "FLUX-6", title: "Dashboard KPI cards", dot: "bg-success" }],
  },
];

function MiniBoard() {
  return (
    <div
      aria-hidden
      className="glass w-full max-w-md p-4 [transform:perspective(1200px)_rotateY(-6deg)_rotateX(2deg)]"
    >
      <div className="grid grid-cols-3 gap-3">
        {MINI_BOARD.map((column) => (
          <div key={column.label} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 px-0.5">
              <span className={`size-1.5 rounded-full ${column.dot}`} />
              <span className="truncate text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                {column.label}
              </span>
            </div>
            {column.cards.map((card) => (
              <div
                key={card.taskKey}
                className={`flex flex-col gap-1.5 rounded-lg border border-white/10 bg-surface-raised p-2.5 ${
                  card.dragging
                    ? "rotate-3 shadow-xl shadow-black/50 ring-2 ring-primary/60"
                    : ""
                }`}
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  {card.taskKey}
                </span>
                <span className="text-xs leading-snug text-foreground">
                  {card.title}
                </span>
                <span className={`size-1.5 rounded-full ${card.dot}`} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

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
      {/* Nav */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
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

      {/* Hero */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6">
        <div className="grid items-center gap-12 py-16 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <div className="flex max-w-xl flex-col gap-6 motion-safe:animate-[landing-rise_300ms_ease-out]">
            <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
              Internal · Invite-only
            </p>
            <h1 className="text-8xl leading-none font-bold tracking-tight text-foreground sm:text-9xl">
              Flux
              <span aria-hidden className="text-primary">
                .
              </span>
            </h1>
            <p className="text-2xl tracking-tight text-foreground sm:text-3xl">
              <span className="font-extralight">Work in</span>{" "}
              <span className="font-semibold">
                motion
                <span aria-hidden className="text-primary">
                  .
                </span>
              </span>
            </p>
            <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
              Flux is where Foodverse teams plan projects, move tasks across the
              board and keep every change on the record — one shared view of
              work as it happens.
            </p>
            <div className="flex flex-wrap items-center gap-3">
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

          <div className="hidden justify-center motion-safe:animate-[landing-rise_300ms_ease-out] sm:flex lg:justify-end">
            <MiniBoard />
          </div>
        </div>

        {/* Features — quiet, solid surface (no glass-on-glass) */}
        <div className="grid gap-4 pb-20 sm:grid-cols-3">
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

      {/* Footer — part of the Foodverse ecosystem */}
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
