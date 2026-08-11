import { describe, expect, it } from "vitest";

import {
  elapsedMinutes,
  formatElapsed,
  pickCurrentTask,
  sortPulseCards,
  type CurrentTaskCandidate,
} from "./shape";

function candidate(over: Partial<CurrentTaskCandidate> = {}): CurrentTaskCandidate {
  return {
    taskId: "t1",
    key: "OPS-1",
    title: "Task",
    projectKey: "OPS",
    priority: "MEDIUM",
    dueDate: null,
    startedAt: null,
    hasRunningTimer: false,
    ...over,
  };
}

describe("elapsedMinutes", () => {
  const now = new Date("2026-08-10T12:00:00Z");

  it("floors to whole minutes", () => {
    expect(elapsedMinutes(new Date("2026-08-10T11:00:30Z"), now)).toBe(59);
  });

  it("clamps a future start to zero rather than going negative", () => {
    expect(elapsedMinutes(new Date("2026-08-10T12:05:00Z"), now)).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("omits hours under 60 minutes", () => {
    expect(formatElapsed(45)).toBe("45m");
    expect(formatElapsed(0)).toBe("0m");
  });

  it("omits minutes on a whole hour", () => {
    expect(formatElapsed(120)).toBe("2h");
  });

  it("shows both parts otherwise", () => {
    expect(formatElapsed(135)).toBe("2h 15m");
  });
});

describe("pickCurrentTask", () => {
  it("returns null for an idle member", () => {
    expect(pickCurrentTask([])).toBeNull();
  });

  it("prefers a running timer over a higher-priority untimed task", () => {
    const picked = pickCurrentTask([
      candidate({ taskId: "urgent", key: "OPS-9", priority: "URGENT" }),
      candidate({
        taskId: "timed",
        key: "OPS-2",
        priority: "LOW",
        hasRunningTimer: true,
        startedAt: new Date("2026-08-10T11:00:00Z"),
      }),
    ]);
    expect(picked?.taskId).toBe("timed");
  });

  it("picks the most recently started of several running timers", () => {
    const picked = pickCurrentTask([
      candidate({
        taskId: "old",
        key: "OPS-1",
        hasRunningTimer: true,
        startedAt: new Date("2026-08-10T09:00:00Z"),
      }),
      candidate({
        taskId: "new",
        key: "OPS-2",
        hasRunningTimer: true,
        startedAt: new Date("2026-08-10T11:30:00Z"),
      }),
    ]);
    expect(picked?.taskId).toBe("new");
  });

  it("falls back to priority, then soonest due date", () => {
    const picked = pickCurrentTask([
      candidate({ taskId: "a", key: "OPS-1", priority: "HIGH", dueDate: null }),
      candidate({
        taskId: "b",
        key: "OPS-2",
        priority: "HIGH",
        dueDate: new Date("2026-08-11T00:00:00Z"),
      }),
      candidate({ taskId: "c", key: "OPS-3", priority: "LOW" }),
    ]);
    expect(picked?.taskId).toBe("b");
  });

  it("is stable for fully-tied candidates (no wall-board flicker)", () => {
    const tied = [
      candidate({ taskId: "b", key: "OPS-2" }),
      candidate({ taskId: "a", key: "OPS-1" }),
    ];
    expect(pickCurrentTask(tied)?.taskId).toBe("a");
    expect(pickCurrentTask([...tied].reverse())?.taskId).toBe("a");
  });
});

describe("sortPulseCards", () => {
  const card = (over: Partial<Parameters<typeof sortPulseCards>[0][number]>) => ({
    name: "Zed",
    availability: "idle" as const,
    overdue: 0,
    activeCount: 0,
    ...over,
  });

  it("puts working members ahead of idle ones", () => {
    const out = sortPulseCards([
      card({ name: "Idle", availability: "idle", overdue: 99 }),
      card({ name: "Busy", availability: "working" }),
    ]);
    expect(out.map((c) => c.name)).toEqual(["Busy", "Idle"]);
  });

  it("ranks by overdue, then active count, then name", () => {
    const out = sortPulseCards([
      card({ name: "Cara", availability: "working", overdue: 1, activeCount: 5 }),
      card({ name: "Abe", availability: "working", overdue: 3, activeCount: 1 }),
      card({ name: "Bo", availability: "working", overdue: 1, activeCount: 9 }),
    ]);
    expect(out.map((c) => c.name)).toEqual(["Abe", "Bo", "Cara"]);
  });

  it("does not mutate the input array", () => {
    const input = [card({ name: "A" }), card({ name: "B", availability: "working" })];
    const snapshot = input.map((c) => c.name);
    sortPulseCards(input);
    expect(input.map((c) => c.name)).toEqual(snapshot);
  });
});
