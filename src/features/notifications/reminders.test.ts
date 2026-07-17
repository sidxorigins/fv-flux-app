import { describe, expect, it } from "vitest";

import { classifyDue } from "./reminders";

const NOW = new Date("2026-07-17T12:00:00.000Z");

describe("classifyDue", () => {
  it("classifies a due date in the past as overdue", () => {
    const dueDate = new Date("2026-07-16T12:00:00.000Z"); // 1 day ago
    expect(classifyDue(dueDate, NOW)).toBe("overdue");
  });

  it("classifies a due date one millisecond in the past as overdue", () => {
    const dueDate = new Date(NOW.getTime() - 1);
    expect(classifyDue(dueDate, NOW)).toBe("overdue");
  });

  it("classifies a due date exactly at now as due-soon (not overdue)", () => {
    expect(classifyDue(new Date(NOW), NOW)).toBe("dueSoon");
  });

  it("classifies a due date a few hours away as due-soon", () => {
    const dueDate = new Date(NOW.getTime() + 3 * 60 * 60 * 1000); // +3h
    expect(classifyDue(dueDate, NOW)).toBe("dueSoon");
  });

  it("classifies a due date just under 24h away as due-soon", () => {
    const dueDate = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 - 1); // +24h - 1ms
    expect(classifyDue(dueDate, NOW)).toBe("dueSoon");
  });

  it("classifies a due date exactly 24h away as null (window is exclusive)", () => {
    const dueDate = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(classifyDue(dueDate, NOW)).toBeNull();
  });

  it("classifies a due date several days out as null", () => {
    const dueDate = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000);
    expect(classifyDue(dueDate, NOW)).toBeNull();
  });
});
