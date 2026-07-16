import "./editor.css";

import { cn } from "@/lib/utils";

/**
 * Read-only renderer for Tiptap-authored rich text (task descriptions,
 * comments). Server-compatible — no "use client" directive, no editor
 * instance, just markup + shared .flux-prose styling.
 *
 * SECURITY: `html` MUST already be server-sanitised (see lib/sanitize.ts)
 * before it reaches this component. This component does NOT sanitise —
 * sanitisation happens once, at persist time, on the server. Never pass raw
 * user input (client state, unvalidated API responses, etc.) here.
 */
interface RichTextContentProps {
  html: string;
  className?: string;
}

export function RichTextContent({ html, className }: RichTextContentProps) {
  return (
    <div
      className={cn("flux-prose", className)}
      // html is sanitised server-side before persist, see lib/sanitize.ts
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
