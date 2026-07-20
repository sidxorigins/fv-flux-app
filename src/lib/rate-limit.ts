// Minimal in-memory sliding-window rate limiter.
//
// SINGLE-INSTANCE ONLY. State lives in a module-level Map in this process's memory:
//   - it resets on every server restart / cold start, and
//   - it is NOT shared across horizontally-scaled instances or serverless workers.
// It is a cheap first line of defence (brute-force / abuse dampening) for a small,
// single-tenant internal app. For multi-instance production, back this with Redis
// (or Cloudflare rate limiting) behind the same `rateLimit()` signature.

interface Bucket {
  hits: number[];
  windowMs: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the Map doesn't grow unbounded from one-off keys.
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    const cutoff = now - bucket.windowMs;
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  /** Max number of allowed hits within the window. */
  limit: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Ms until the oldest hit in the window expires (0 when `ok`). */
  retryAfterMs: number;
  /** Remaining hits allowed in the current window. */
  remaining: number;
}

/**
 * Record and evaluate a hit for `key`. Returns `{ ok: false, retryAfterMs }` when
 * the caller has exceeded `limit` within `windowMs`; the rejected hit is not
 * counted so the window can drain.
 */
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const windowStart = now - opts.windowMs;
  const bucket = buckets.get(key) ?? { hits: [], windowMs: opts.windowMs };
  bucket.windowMs = opts.windowMs;
  bucket.hits = bucket.hits.filter((t) => t > windowStart);

  if (bucket.hits.length >= opts.limit) {
    buckets.set(key, bucket);
    const retryAfterMs = bucket.hits[0] + opts.windowMs - now;
    return { ok: false, retryAfterMs: Math.max(0, retryAfterMs), remaining: 0 };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, retryAfterMs: 0, remaining: opts.limit - bucket.hits.length };
}
