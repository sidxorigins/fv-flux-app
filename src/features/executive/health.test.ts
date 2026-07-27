import { describe, expect, it } from "vitest";

import { projectHealth, type HealthInputs } from "./health";

const healthy: HealthInputs = {
  open: 5,
  overdue: 0,
  unassignedUrgent: 0,
  activity14d: 12,
};

describe("projectHealth", () => {
  it("is ON_TRACK when nothing is late, unowned, or silent", () => {
    expect(projectHealth(healthy)).toBe("ON_TRACK");
  });

  it("is AT_RISK with any overdue task", () => {
    expect(projectHealth({ ...healthy, overdue: 1 })).toBe("AT_RISK");
  });

  it("is AT_RISK with an unassigned urgent task", () => {
    expect(projectHealth({ ...healthy, unassignedUrgent: 1 })).toBe("AT_RISK");
  });

  it("is STALLED when silent for 14 days with open work", () => {
    expect(projectHealth({ ...healthy, activity14d: 0 })).toBe("STALLED");
  });

  it("prefers STALLED over AT_RISK when both apply", () => {
    // Silence is the more actionable signal: nobody is touching it at all.
    expect(
      projectHealth({ ...healthy, activity14d: 0, overdue: 3 }),
    ).toBe("STALLED");
  });

  it("is ON_TRACK when silent but with NO open work (finished, not stalled)", () => {
    expect(projectHealth({ ...healthy, open: 0, activity14d: 0 })).toBe("ON_TRACK");
  });

  it("does NOT flag a week-over-week completion decline", () => {
    // Deliberately rejected as a trigger: it would paint healthy projects amber
    // on a quiet week, and a signal that fires on healthy projects stops being
    // read. Amber means late work or unowned urgent work — nothing else.
    expect(projectHealth(healthy)).toBe("ON_TRACK");
  });

  it("treats exactly zero overdue as not-at-risk (boundary)", () => {
    expect(projectHealth({ ...healthy, overdue: 0 })).toBe("ON_TRACK");
  });
});
