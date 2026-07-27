import { describe, expect, it } from "vitest";

import { defaultLandingPath } from "./landing";

describe("defaultLandingPath", () => {
  it("sends an executive to the overview", () => {
    expect(defaultLandingPath("EXECUTIVE")).toBe("/executive");
  });

  it("sends an admin to the personal dashboard", () => {
    expect(defaultLandingPath("ADMIN")).toBe("/dashboard");
  });

  it("sends a regular user to the personal dashboard", () => {
    expect(defaultLandingPath("USER")).toBe("/dashboard");
  });

  it("falls back to the dashboard for an unknown role", () => {
    expect(defaultLandingPath(undefined)).toBe("/dashboard");
  });
});
