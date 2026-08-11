import { describe, expect, it } from "vitest";

import {
  DISPLAY_TOKEN_PREFIX,
  generateDisplayToken,
  hashDisplayToken,
  hashesMatch,
  looksLikeDisplayToken,
} from "./display-token";

describe("generateDisplayToken", () => {
  it("mints a prefixed token with a matching hash and prefix", () => {
    const { token, prefix, tokenHash } = generateDisplayToken();
    expect(token.startsWith(DISPLAY_TOKEN_PREFIX)).toBe(true);
    expect(prefix).toBe(token.slice(0, 16));
    expect(tokenHash).toBe(hashDisplayToken(token));
  });

  it("never repeats", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateDisplayToken().token),
    );
    expect(seen.size).toBe(50);
  });

  it("stores a hash, not the token itself", () => {
    const { token, tokenHash } = generateDisplayToken();
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("looksLikeDisplayToken", () => {
  it("accepts a freshly minted token", () => {
    expect(looksLikeDisplayToken(generateDisplayToken().token)).toBe(true);
  });

  it("rejects junk without needing a database lookup", () => {
    for (const bad of ["", "hello", "flux_sk_abcdefghijklmnop", "flux_dt_short"]) {
      expect(looksLikeDisplayToken(bad)).toBe(false);
    }
  });

  it("rejects an absurdly long value", () => {
    expect(looksLikeDisplayToken(DISPLAY_TOKEN_PREFIX + "x".repeat(200))).toBe(false);
  });
});

describe("hashesMatch", () => {
  it("matches identical hashes", () => {
    const h = hashDisplayToken("abc");
    expect(hashesMatch(h, h)).toBe(true);
  });

  it("rejects different hashes", () => {
    expect(hashesMatch(hashDisplayToken("abc"), hashDisplayToken("abd"))).toBe(false);
  });

  it("rejects empty or malformed input rather than throwing", () => {
    expect(hashesMatch("", "")).toBe(false);
    expect(hashesMatch("zz", hashDisplayToken("a"))).toBe(false);
  });
});
