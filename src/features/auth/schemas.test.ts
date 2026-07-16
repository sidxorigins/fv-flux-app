import { describe, expect, it } from "vitest";
import { passwordSchema, usernameSchema } from "./schemas";

const RESERVED = [
  "admin",
  "api",
  "support",
  "system",
  "root",
  "flux",
  "foodverse",
  "help",
  "security",
  "noreply",
];

describe("usernameSchema", () => {
  it("accepts a valid lowercase username", () => {
    const result = usernameSchema.safeParse("valid_user1");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("valid_user1");
  });

  it("trims and lowercases BEFORE validating — mixed-case input normalises rather than rejects", () => {
    const result = usernameSchema.safeParse("  MyName_1  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("myname_1");
  });

  it("rejects a username shorter than 3 characters (post-trim)", () => {
    const result = usernameSchema.safeParse("ab");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Username must be at least 3 characters",
      );
    }
  });

  it("rejects a username longer than 30 characters", () => {
    const result = usernameSchema.safeParse("a".repeat(31));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Username must be at most 30 characters",
      );
    }
  });

  it("accepts exactly 3 and exactly 30 characters (boundary)", () => {
    expect(usernameSchema.safeParse("abc").success).toBe(true);
    expect(usernameSchema.safeParse("a".repeat(30)).success).toBe(true);
  });

  it("rejects invalid characters (anything outside [a-z0-9_])", () => {
    const result = usernameSchema.safeParse("bad-name!");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Username may only contain lowercase letters, numbers, and underscores",
      );
    }
  });

  it("rejects a leading underscore", () => {
    const result = usernameSchema.safeParse("_leading");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Username can't start or end with an underscore",
      );
    }
  });

  it("rejects a trailing underscore", () => {
    const result = usernameSchema.safeParse("trailing_");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Username can't start or end with an underscore",
      );
    }
  });

  it.each(RESERVED)("rejects the reserved handle %s", (reserved) => {
    const result = usernameSchema.safeParse(reserved);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("That username is reserved");
    }
  });

  it.each(RESERVED)("rejects the reserved handle %s in mixed case (normalised first)", (reserved) => {
    const result = usernameSchema.safeParse(reserved.toUpperCase());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("That username is reserved");
    }
  });

  it("does not reject a username that merely contains a reserved word as a substring", () => {
    // Reserved check is an exact-match Set lookup, not a substring/prefix check.
    expect(usernameSchema.safeParse("admin2").success).toBe(true);
    expect(usernameSchema.safeParse("super_admin").success).toBe(true);
  });
});

describe("passwordSchema", () => {
  it("rejects passwords shorter than 10 characters", () => {
    const result = passwordSchema.safeParse("abc12345"); // 8 chars
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Password must be at least 10 characters",
      );
    }
  });

  it("accepts exactly 10 characters when it has a letter and a digit", () => {
    expect(passwordSchema.safeParse("abcdefgh1a").success).toBe(true);
  });

  it("rejects passwords over the 200 character max", () => {
    const result = passwordSchema.safeParse("a1".repeat(101)); // 202 chars
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Password must be at most 200 characters",
      );
    }
  });

  it("rejects an all-letters password (missing digit requirement)", () => {
    const result = passwordSchema.safeParse("abcdefghij");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Password must contain at least one number",
      );
    }
  });

  it("rejects an all-digits password (missing letter requirement)", () => {
    const result = passwordSchema.safeParse("1234567890");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Password must contain at least one letter",
      );
    }
  });

  it("accepts a password with both a letter and a digit", () => {
    expect(passwordSchema.safeParse("correcthorse1").success).toBe(true);
  });
});
