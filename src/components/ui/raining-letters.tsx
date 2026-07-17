"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Raining Letters hero pieces — adapted from the 21st.dev
 * "modern-animated-hero-section" community component.
 *
 * Changes from the original (CLAUDE.md: 21st.dev code is a starting point,
 * re-themed to our tokens):
 * - Matrix green → Flux tokens: idle glyphs use --muted-foreground, active
 *   glyphs and scramble placeholders glow --primary (Foodverse orange).
 * - styled-jsx dropped; the `.dud` scramble class lives in globals.css.
 * - Fewer, smaller glyphs (140 vs 300, text-sm/lg vs 1.8rem) so the hero
 *   stays cheap and the copy stays readable.
 * - prefers-reduced-motion: no rain, no flicker, headline rendered static.
 * - Scrambled title keeps a stable sr-only label; the animated element is
 *   aria-hidden (innerHTML churn is useless noise to screen readers).
 * - Landing-page garnish only — never mount inside the work tool.
 */

const GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";

interface RainGlyph {
  char: string;
  x: number;
  y: number;
  speed: number;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Text scramble (decode) effect — ported intact from the 21st.dev source. */
class TextScramble {
  el: HTMLElement;
  chars: string;
  queue: Array<{
    from: string;
    to: string;
    start: number;
    end: number;
    char?: string;
  }>;
  frame: number;
  frameRequest: number;
  resolve: (value: void | PromiseLike<void>) => void;

  constructor(el: HTMLElement) {
    this.el = el;
    this.chars = "!<>-_\\/[]{}—=+*^?#";
    this.queue = [];
    this.frame = 0;
    this.frameRequest = 0;
    this.resolve = () => {};
    this.update = this.update.bind(this);
  }

  setText(newText: string) {
    const oldText = this.el.innerText;
    const length = Math.max(oldText.length, newText.length);
    const promise = new Promise<void>((resolve) => (this.resolve = resolve));
    this.queue = [];

    for (let i = 0; i < length; i++) {
      const from = oldText[i] || "";
      const to = newText[i] || "";
      const start = Math.floor(Math.random() * 40);
      const end = start + Math.floor(Math.random() * 40);
      this.queue.push({ from, to, start, end });
    }

    cancelAnimationFrame(this.frameRequest);
    this.frame = 0;
    this.update();
    return promise;
  }

  stop() {
    cancelAnimationFrame(this.frameRequest);
  }

  update() {
    let output = "";
    let complete = 0;

    for (let i = 0, n = this.queue.length; i < n; i++) {
      const item = this.queue[i];
      if (this.frame >= item.end) {
        complete++;
        output += item.to;
      } else if (this.frame >= item.start) {
        if (!item.char || Math.random() < 0.28) {
          item.char = this.chars[Math.floor(Math.random() * this.chars.length)];
        }
        output += `<span class="dud">${item.char}</span>`;
      } else {
        output += item.from;
      }
    }

    this.el.innerHTML = output;
    if (complete === this.queue.length) {
      this.resolve();
    } else {
      this.frameRequest = requestAnimationFrame(this.update);
      this.frame++;
    }
  }
}

interface ScrambledTitleProps {
  /** Phrases the headline cycles through (scramble-decodes between them). */
  phrases: string[];
  /** Stable accessible name — what screen readers announce. */
  label: string;
  className?: string;
  /** Milliseconds a decoded phrase stays before the next scramble. */
  holdMs?: number;
  /** Element to render as — h1 by default; pass "p" when it's a tagline. */
  as?: React.ElementType;
}

export function ScrambledTitle({
  phrases,
  label,
  className,
  holdMs = 2200,
  as: Tag = "h1",
}: ScrambledTitleProps) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const scramblerRef = useRef<TextScramble | null>(null);

  useEffect(() => {
    const el = elementRef.current;
    if (!el || prefersReducedMotion()) return;

    const scrambler = new TextScramble(el);
    scramblerRef.current = scrambler;

    let counter = 0;
    let timeout: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const next = () => {
      if (cancelled) return;
      scrambler.setText(phrases[counter]).then(() => {
        timeout = setTimeout(next, holdMs);
      });
      counter = (counter + 1) % phrases.length;
    };
    next();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      scrambler.stop();
    };
  }, [phrases, holdMs]);

  return (
    <Tag className={className}>
      <span className="sr-only">{label}</span>
      {/* Static first phrase for SSR / reduced motion; scrambler takes over. */}
      <span ref={elementRef} aria-hidden className="scramble-target">
        {phrases[0]}
      </span>
    </Tag>
  );
}

interface LetterRainProps {
  /** How many glyphs fall. Keep low — every glyph is a DOM node. */
  count?: number;
  className?: string;
}

/** Full-bleed falling-glyph backdrop. Renders nothing under reduced motion. */
export function LetterRain({ count = 140, className }: LetterRainProps) {
  const [glyphs, setGlyphs] = useState<RainGlyph[]>([]);
  const [activeIndices, setActiveIndices] = useState<Set<number>>(new Set());
  const [enabled, setEnabled] = useState(false);

  const createGlyphs = useCallback(() => {
    const next: RainGlyph[] = [];
    for (let i = 0; i < count; i++) {
      next.push({
        char: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        x: Math.random() * 100,
        y: Math.random() * 100,
        speed: 0.08 + Math.random() * 0.22,
      });
    }
    return next;
  }, [count]);

  // Client-only init, deferred a frame so the rain never competes with the
  // hero's first paint (and to keep setState out of the effect body).
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = requestAnimationFrame(() => {
      setEnabled(true);
      setGlyphs(createGlyphs());
    });
    return () => cancelAnimationFrame(id);
  }, [createGlyphs]);

  // A few glyphs flicker orange at a time.
  useEffect(() => {
    if (!enabled || glyphs.length === 0) return;
    const flicker = setInterval(() => {
      const next = new Set<number>();
      const numActive = Math.floor(Math.random() * 3) + 3;
      for (let i = 0; i < numActive; i++) {
        next.add(Math.floor(Math.random() * glyphs.length));
      }
      setActiveIndices(next);
    }, 120);
    return () => clearInterval(flicker);
  }, [enabled, glyphs.length]);

  // Fall loop.
  useEffect(() => {
    if (!enabled) return;
    let frame: number;
    const fall = () => {
      setGlyphs((prev) =>
        prev.map((g) =>
          g.y >= 102
            ? {
                char: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
                x: Math.random() * 100,
                y: -4,
                speed: 0.08 + Math.random() * 0.22,
              }
            : { ...g, y: g.y + g.speed },
        ),
      );
      frame = requestAnimationFrame(fall);
    };
    frame = requestAnimationFrame(fall);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`}
    >
      {glyphs.map((glyph, index) => {
        const active = activeIndices.has(index);
        return (
          <span
            key={index}
            className={
              active
                ? "absolute text-lg font-semibold text-primary"
                : "absolute text-sm font-light text-muted-foreground"
            }
            style={{
              left: `${glyph.x}%`,
              top: `${glyph.y}%`,
              transform: `translate(-50%, -50%) scale(${active ? 1.2 : 1})`,
              opacity: active ? 0.95 : 0.28,
              textShadow: active
                ? "0 0 10px color-mix(in srgb, var(--primary) 65%, transparent)"
                : "none",
              transition: "color 0.12s, transform 0.12s, opacity 0.12s",
              willChange: "top, transform",
            }}
          >
            {glyph.char}
          </span>
        );
      })}
    </div>
  );
}
