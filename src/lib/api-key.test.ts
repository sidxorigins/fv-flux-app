import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, API_KEY_PREFIX } from "./api-key";

describe("api-key", () => {
  it("generates a flux_sk_ key with a matching hash + prefix", () => {
    const { key, prefix, keyHash } = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(prefix).toBe(key.slice(0, 16));
    expect(keyHash).toBe(hashApiKey(key));
    expect(keyHash).toHaveLength(64); // sha256 hex
  });
  it("hashApiKey is deterministic + differs per key", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(hashApiKey(a.key)).toBe(hashApiKey(a.key));
    expect(hashApiKey(a.key)).not.toBe(hashApiKey(b.key));
    expect(a.key).not.toBe(b.key);
  });
});
