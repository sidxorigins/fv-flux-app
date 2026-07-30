import type { MetadataRoute } from "next";

/**
 * Web app manifest — served at /manifest.webmanifest by Next's file
 * convention. Makes Flux installable as a PWA (Add to Home Screen / Install
 * app) with the right name, colours, and icons instead of a browser-generated
 * screenshot.
 *
 * Colours mirror the tokens in globals.css: `background_color` is the app base
 * (--background) so the splash screen matches the shell rather than flashing
 * white, and `theme_color` is the same near-black so Android's status bar
 * blends into the header. Orange stays the accent inside the icon, not the
 * chrome — see CLAUDE.md "Look & Feel".
 *
 * `display: standalone` drops the browser UI; `start_url: "/"` lets the
 * landing page resolve the role-aware destination server-side (see
 * lib/landing.ts), which is also what an installed launcher should do.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Flux — Foodverse",
    short_name: "Flux",
    description: "Task & project management for Foodverse",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
    categories: ["productivity", "business"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Maskable variants carry extra padding so Android can crop them to a
      // circle or squircle without clipping the mark.
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
