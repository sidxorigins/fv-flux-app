import { describe, expect, it } from "vitest";
import { generateInviteToken, hashToken, timingSafeEqualHex } from "./tokens";

// base64url alphabet: A-Z a-z 0-9 - _  (no padding, no + or /)
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

describe("generateInviteToken", () => {
  it("produces a 43-char string — the unpadded base64url encoding of 32 bytes", () => {
    const token = generateInviteToken();
    // ceil(32 bytes * 8 bits / 6 bits-per-char) = 43, with no '=' padding.
    expect(token).toHaveLength(43);
  });

  it("only uses the base64url charset (no +, /, or = padding)", () => {
    const token = generateInviteToken();
    expect(token).toMatch(BASE64URL_RE);
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
  });

  it("has high entropy — many bits actually vary across calls (not a constant/degenerate string)", () => {
    const token = generateInviteToken();
    // 32 random bytes should not collapse to a single repeated character.
    expect(new Set(token.split("")).size).toBeGreaterThan(1);
  });

  it("is unique across many calls", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateInviteToken()));
    expect(tokens.size).toBe(1000);
  });
});

describe("hashToken", () => {
  it("is deterministic for the same input", () => {
    expect(hashToken("my-raw-token")).toBe(hashToken("my-raw-token"));
  });

  it("produces a 64-char lowercase hex digest (SHA-256)", () => {
    const hash = hashToken("abc");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the well-known SHA-256 digest of 'abc'", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});

describe("timingSafeEqualHex", () => {
  it("returns true for two identical hex digests", () => {
    const hash = hashToken("same-input");
    expect(timingSafeEqualHex(hash, hashToken("same-input"))).toBe(true);
  });

  it("returns false for two different hex digests of the same length", () => {
    expect(timingSafeEqualHex(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("returns false immediately when lengths differ", () => {
    expect(timingSafeEqualHex("ab", "abcd")).toBe(false);
  });

  it("returns false for malformed (non-hex) equal-length input rather than throwing", () => {
    // "zz" isn't valid hex — Buffer.from(..., 'hex') yields a 0-length buffer for
    // both sides, which the guard rejects rather than comparing two empty buffers.
    expect(timingSafeEqualHex("zz", "zz")).toBe(false);
  });

  it("returns false for an empty-string comparison", () => {
    expect(timingSafeEqualHex("", "")).toBe(false);
  });
});
