import { describe, expect, it } from "vitest";
import { projectKeySchema } from "./schemas";

describe("projectKeySchema", () => {
  it("rejects a single character (below the 2-char minimum)", () => {
    const result = projectKeySchema.safeParse("A");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Key must be at least 2 characters",
      );
    }
  });

  it("accepts exactly 2 characters (boundary)", () => {
    const result = projectKeySchema.safeParse("AB");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("AB");
  });

  it("accepts exactly 6 characters (boundary)", () => {
    const result = projectKeySchema.safeParse("ABCDEF");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("ABCDEF");
  });

  it("rejects 7 characters (above the 6-char maximum)", () => {
    const result = projectKeySchema.safeParse("ABCDEFG");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Key must be at most 6 characters",
      );
    }
  });

  it("rejects a key that starts with a digit", () => {
    const result = projectKeySchema.safeParse("1AB");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Key must start with a letter and contain only A–Z and 0–9",
      );
    }
  });

  it("rejects non-alphanumeric characters", () => {
    const result = projectKeySchema.safeParse("AB-C");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Key must start with a letter and contain only A–Z and 0–9",
      );
    }
  });

  it("accepts a letter followed by digits", () => {
    expect(projectKeySchema.safeParse("A1").success).toBe(true);
    expect(projectKeySchema.safeParse("OPS42").success).toBe(true);
  });

  it("uppercases lowercase input BEFORE validating", () => {
    const result = projectKeySchema.safeParse("ops");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("OPS");
  });

  it("trims surrounding whitespace before validating", () => {
    const result = projectKeySchema.safeParse("  ops  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("OPS");
  });
});
