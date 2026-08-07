// Public API reference — the raw Markdown of API.md, served unauthenticated so
// other apps and agents can fetch it directly (no session, no API key).
//
// PUBLIC BY DESIGN: this is documentation, not data. It describes endpoints and
// the auth model; it contains no keys, no user data, and no DB access. The route
// is listed in proxy.ts's PUBLIC_PREFIXES so the session gate lets it through.
//
// The Markdown is embedded at build time (features/docs/api-doc.generated.ts,
// produced from API.md by scripts/gen-api-docs.mjs) — no filesystem read at
// request time, so it behaves the same in dev and in the standalone build.

import { API_DOC_MARKDOWN } from "@/features/docs/api-doc.generated";

// Static: the content is a build-time constant, so Next can cache it outright.
export const dynamic = "force-static";

const HEADERS = {
  // text/* so browsers render it inline instead of downloading it.
  "Content-Type": "text/markdown; charset=utf-8",
  // Readable from any origin — it's public documentation, and a browser-based
  // integration fetching it cross-origin is exactly the intended use.
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
} as const;

export async function GET(): Promise<Response> {
  return new Response(API_DOC_MARKDOWN, { status: 200, headers: HEADERS });
}

// Preflight for cross-origin fetches that send custom headers.
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}
