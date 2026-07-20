import { describe, expect, it } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  it("allows up to the limit then blocks within the window", () => {
    const key = `k-${Math.random()}`; // unique per run — avoids cross-test bleed
    for (let i = 0; i < 3; i++) expect(checkRateLimit(key, 3, 60000).ok).toBe(true);
    const blocked = checkRateLimit(key, 3, 60000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});
