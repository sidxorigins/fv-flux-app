"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import { cn } from "@/lib/utils";

/**
 * Vanishing Text — a slow wave travels through the wordmark: each letter
 * blurs and fades out for a beat, then returns, one after another.
 *
 * Same per-letter structure as the 21st.dev text components (split into
 * aria-hidden spans + sr-only copy), animated with the project's GSAP stack.
 * Letters animate opacity/filter only — no reflow, no layout shift.
 *
 * - Landing-page garnish only (CLAUDE.md motion rules: the app itself sits
 *   still). No-ops under prefers-reduced-motion; useGSAP reverts on unmount.
 */
interface VanishingTextProps {
  text: string;
  className?: string;
  /** Seconds for one letter to vanish (the return takes the same). */
  duration?: number;
  /** Seconds between one letter starting to vanish and the next. */
  stagger?: number;
  /** Pause with the full word visible before the wave repeats. */
  holdDelay?: number;
}

export function VanishingText({
  text,
  className,
  duration = 0.45,
  stagger = 0.28,
  holdDelay = 1.8,
}: VanishingTextProps) {
  const scope = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Keyframes (out, then straight back in) so repeatDelay holds the word
      // fully visible between waves — yoyo+repeatDelay would park letters
      // invisible for the delay instead.
      gsap.to(".vanishing-letter", {
        keyframes: [
          { opacity: 0, filter: "blur(10px)", duration, ease: "power2.in" },
          { opacity: 1, filter: "blur(0px)", duration, ease: "power2.out" },
        ],
        repeat: -1,
        repeatDelay: holdDelay,
        stagger: { each: stagger },
      });
    },
    { scope },
  );

  return (
    <span ref={scope} className={className}>
      <span className="sr-only">{text}</span>
      {text.split("").map((letter, i) => (
        <span
          key={`${letter}-${i}`}
          aria-hidden
          className={cn("vanishing-letter inline-block")}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}
