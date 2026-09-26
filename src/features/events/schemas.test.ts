import { describe, expect, it } from "vitest";
import {
  clockToMinutes,
  createEventSchema,
  createSessionSchema,
  eventSlug,
  upsertAssignmentSchema,
} from "./schemas";

describe("event schemas", () => {
  it("accepts a valid event and normalises the slug", () => {
    const r = createEventSchema.safeParse({
      name: "Expogast 2026",
      slug: " Expogast-2026 ",
      startDate: "2026-11-20",
      endDate: "2026-11-26",
      timezone: "Europe/Luxembourg",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.slug).toBe("expogast-2026");
  });

  it("rejects an end date before the start date", () => {
    const r = createEventSchema.safeParse({
      name: "X",
      slug: "x-y",
      startDate: "2026-11-26",
      endDate: "2026-11-20",
    });
    expect(r.success).toBe(false);
  });

  it("rejects bad slugs", () => {
    for (const bad of ["ab", "Has Space", "-lead", "trail-", "double--hyphen", "ünïcode"]) {
      expect(eventSlug.safeParse(bad).success, bad).toBe(false);
    }
    expect(eventSlug.safeParse("ok-slug-1").success).toBe(true);
  });

  it("validates session clock times and blanks them to null", () => {
    const ok = createSessionSchema.safeParse({
      dayId: "d1",
      title: "Opening",
      startTime: "17:00",
      endTime: "",
      timeLabel: "",
      location: "",
      focus: "",
      priority: "MUST_FILM",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.endTime).toBeNull();
      expect(ok.data.timeLabel).toBeNull();
      expect(ok.data.location).toBeNull();
    }
    expect(createSessionSchema.safeParse({ dayId: "d1", title: "X", startTime: "25:00", priority: "HIGH" }).success).toBe(false);
    expect(createSessionSchema.safeParse({ dayId: "d1", title: "X", startTime: "9:30", priority: "HIGH" }).success).toBe(false);
  });

  it("requires end after start, except for past-midnight ends", () => {
    expect(createSessionSchema.safeParse({ dayId: "d1", title: "X", startTime: "14:00", endTime: "13:00", priority: "HIGH" }).success).toBe(false);
    // After Party 21:00–01:00
    expect(createSessionSchema.safeParse({ dayId: "d1", title: "X", startTime: "21:00", endTime: "01:00", priority: "HIGH" }).success).toBe(true);
  });

  it("rejects unknown priorities", () => {
    expect(createSessionSchema.safeParse({ dayId: "d1", title: "X", priority: "URGENT" }).success).toBe(false);
  });

  it("trims crew roles and blanks them to null", () => {
    const r = upsertAssignmentSchema.safeParse({ sessionId: "s", userId: "u", role: "  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.role).toBeNull();
  });

  it("converts clock time to minutes", () => {
    expect(clockToMinutes("00:00")).toBe(0);
    expect(clockToMinutes("10:30")).toBe(630);
    expect(clockToMinutes("23:59")).toBe(1439);
  });
});
