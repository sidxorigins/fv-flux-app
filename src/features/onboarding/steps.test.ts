import { describe, expect, it } from "vitest";
import { dashboardTourSteps } from "./steps";

describe("dashboardTourSteps", () => {
  it("includes the Admin step only for admins", () => {
    const admin = dashboardTourSteps(true);
    const member = dashboardTourSteps(false);
    expect(admin.some((s) => s.target === '[data-tour="nav-admin"]')).toBe(true);
    expect(member.some((s) => s.target === '[data-tour="nav-admin"]')).toBe(false);
    expect(admin.length).toBe(member.length + 1);
  });
  it("starts with a welcome (no target) and ends with a finish (no target)", () => {
    const steps = dashboardTourSteps(false);
    expect(steps[0]?.target).toBeNull();
    expect(steps[steps.length - 1]?.target).toBeNull();
  });
});
