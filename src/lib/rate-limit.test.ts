import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "./rate-limit";

const START = new Date("2026-01-01T00:00:00.000Z");

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows hits up to the limit", () => {
    const key = "allow-up-to-limit";
    const opts = { limit: 3, windowMs: 1000 };

    const r1 = rateLimit(key, opts);
    const r2 = rateLimit(key, opts);
    const r3 = rateLimit(key, opts);

    expect(r1).toMatchObject({ ok: true, remaining: 2 });
    expect(r2).toMatchObject({ ok: true, remaining: 1 });
    expect(r3).toMatchObject({ ok: true, remaining: 0 });
  });

  it("blocks once the limit is exceeded within the window", () => {
    const key = "blocks-over-limit";
    const opts = { limit: 2, windowMs: 1000 };

    rateLimit(key, opts);
    rateLimit(key, opts);
    const blocked = rateLimit(key, opts);

    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("does not count a rejected (blocked) hit against the window", () => {
    const key = "rejected-not-counted";
    const opts = { limit: 1, windowMs: 1000 };

    rateLimit(key, opts); // consumes the only slot
    const blocked1 = rateLimit(key, opts);
    const blocked2 = rateLimit(key, opts);

    expect(blocked1.ok).toBe(false);
    expect(blocked2.ok).toBe(false);
    // Both blocked calls should report the same retryAfterMs since the
    // rejected hits were never recorded — the window's oldest hit is unchanged.
    expect(blocked2.retryAfterMs).toBe(blocked1.retryAfterMs);
  });

  it("reports a sane retryAfterMs — bounded by the window length", () => {
    const key = "retry-after-sane";
    const opts = { limit: 1, windowMs: 5000 };

    rateLimit(key, opts);
    const blocked = rateLimit(key, opts);

    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(opts.windowMs);
  });

  it("slides the window — allows again once the oldest hit has expired", () => {
    const key = "window-slides";
    const opts = { limit: 1, windowMs: 1000 };

    const first = rateLimit(key, opts);
    expect(first.ok).toBe(true);

    const stillBlocked = rateLimit(key, opts);
    expect(stillBlocked.ok).toBe(false);

    // Advance past the window.
    vi.setSystemTime(new Date(START.getTime() + opts.windowMs + 1));

    const afterSlide = rateLimit(key, opts);
    expect(afterSlide.ok).toBe(true);
    expect(afterSlide.remaining).toBe(0);
  });

  it("partially slides — only hits older than the window drop off", () => {
    const key = "partial-slide";
    const opts = { limit: 2, windowMs: 1000 };

    rateLimit(key, opts); // hit at t=0
    vi.setSystemTime(new Date(START.getTime() + 600));
    rateLimit(key, opts); // hit at t=600

    // At t=1001, the t=0 hit has expired (outside the 1000ms window) but the
    // t=600 hit has not, so exactly one slot should be free.
    vi.setSystemTime(new Date(START.getTime() + 1001));
    const result = rateLimit(key, opts);
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(0); // one old hit expired, one (t=600) + this one now fill it
  });

  it("tracks separate keys independently", () => {
    const opts = { limit: 1, windowMs: 1000 };

    const keyA1 = rateLimit("indep-a", opts);
    const keyABlocked = rateLimit("indep-a", opts);
    const keyB1 = rateLimit("indep-b", opts);

    expect(keyA1.ok).toBe(true);
    expect(keyABlocked.ok).toBe(false);
    expect(keyB1.ok).toBe(true); // unaffected by key "indep-a" being exhausted
  });
});
