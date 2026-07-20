import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit then blocks within the window", () => {
    const key = `k-${Math.random()}`; // unique per run — avoids cross-test bleed
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, { limit: 3, windowMs: 60000 }).ok).toBe(true);
    }
    const blocked = rateLimit(key, { limit: 3, windowMs: 60000 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });
});
