// Focused tests for the task update Zod schema's `estimatedHours` field (Teams Org
// Foundation Phase A, task A5). The rest of updateTaskSchema is exercised indirectly
// through actions.test.ts; this file isolates the new field's boundary behaviour.

import { describe, expect, it } from "vitest";

import { updateTaskSchema } from "./schemas";

describe("updateTaskSchema — estimatedHours", () => {
  it("accepts null (clearing the estimate)", () => {
    const result = updateTaskSchema.safeParse({
      taskId: "task-1",
      estimatedHours: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.estimatedHours).toBeNull();
  });

  it("accepts a fractional value (0.5)", () => {
    const result = updateTaskSchema.safeParse({
      taskId: "task-1",
      estimatedHours: 0.5,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.estimatedHours).toBe(0.5);
  });

  it("accepts 40", () => {
    const result = updateTaskSchema.safeParse({
      taskId: "task-1",
      estimatedHours: 40,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.estimatedHours).toBe(40);
  });

  it("is optional — omitting it is valid", () => {
    const result = updateTaskSchema.safeParse({ taskId: "task-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.estimatedHours).toBeUndefined();
  });

  it("rejects a negative value (-1)", () => {
    const result = updateTaskSchema.safeParse({
      taskId: "task-1",
      estimatedHours: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a value over the 10000 cap (10001)", () => {
    const result = updateTaskSchema.safeParse({
      taskId: "task-1",
      estimatedHours: 10001,
    });
    expect(result.success).toBe(false);
  });
});
