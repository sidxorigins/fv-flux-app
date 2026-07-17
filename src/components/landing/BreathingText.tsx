"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import { cn } from "@/lib/utils";

/**
 * Breathing Text — per-letter oscillation of the variable-font weight axis
 * with a centre-out stagger, so the wordmark slowly "breathes".
 *
 * Ported from the 21st.dev / fancycomponents.dev "Breathing Text" component
 * (Daniel Petho, MIT) onto this project's GSAP stack instead of adding the
 * `motion` dependency. Requires a variable font with a `wght` axis (Outfit,
 * loaded via next/font, qualifies).
 *
 * - Landing-page garnish only — never use inside the work tool (CLAUDE.md
 *   motion rules: nothing lingers in the app).
 * - No-ops under prefers-reduced-motion; useGSAP reverts on unmount.
 */
interface BreathingTextProps {
  text: string;
  className?: string;
  /** Resting `wght` value — matches the static render before hydration. */
  fromWeight?: number;
  /** Weight the letters breathe down to. */
  toWeight?: number;
  /** Seconds for one inhale/exhale half-cycle. */
  duration?: number;
  /** Per-letter stagger in seconds (wave spreads from the centre). */
  stagger?: number;
}

export function BreathingText({
  text,
  className,
  fromWeight = 700,
  toWeight = 500,
  duration = 2,
  stagger = 0.15,
}: BreathingTextProps) {
  const scope = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.to(".breathing-letter", {
        fontVariationSettings: `'wght' ${toWeight}`,
        duration,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        stagger: { each: stagger, from: "center" },
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
          className={cn("breathing-letter inline-block")}
          style={{ fontVariationSettings: `'wght' ${fromWeight}` }}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}
