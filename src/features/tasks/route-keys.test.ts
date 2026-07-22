// Key-resolution query helpers (Task 2): resolveTaskIdByKey (tasks/queries.ts) and
// resolveProjectIdByKey (projects/queries.ts). Both modules import @/lib/db and
// @/lib/permissions at module scope; @/lib/permissions transitively pulls in
// next-auth (via @/lib/auth), which breaks module resolution under Vitest. Stub
// both with a controllable findUnique per the pattern in ./queries.test.ts — here
// the mock is asserted on directly (call args + return value), not just present
// to satisfy the import chain.
//
// isCuid is already covered in ./share.test.ts — not duplicated here.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/permissions", () => ({
  canViewProject: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    label: {},
  },
}));

import { prisma } from "@/lib/db";
import { resolveTaskIdByKey } from "./queries";
import { resolveProjectIdByKey } from "@/features/projects/queries";

const taskFindUnique = prisma.task.findUnique as unknown as Mock;
const projectFindUnique = prisma.project.findUnique as unknown as Mock;

beforeEach(() => {
  taskFindUnique.mockReset();
  projectFindUnique.mockReset();
});

describe("resolveTaskIdByKey", () => {
  it("uppercases the incoming key before the lookup", async () => {
    taskFindUnique.mockResolvedValue(null);
    await resolveTaskIdByKey("eisc-9");
    expect(taskFindUnique).toHaveBeenCalledWith({
      where: { key: "EISC-9" },
      select: { id: true },
    });
  });

  it("returns the row id when found", async () => {
    taskFindUnique.mockResolvedValue({ id: "cmr_task_123" });
    const result = await resolveTaskIdByKey("EISC-9");
    expect(result).toBe("cmr_task_123");
  });

  it("returns null when not found", async () => {
    taskFindUnique.mockResolvedValue(null);
    const result = await resolveTaskIdByKey("EISC-404");
    expect(result).toBeNull();
  });
});

describe("resolveProjectIdByKey", () => {
  it("uppercases the incoming key before the lookup", async () => {
    projectFindUnique.mockResolvedValue(null);
    await resolveProjectIdByKey("eisc");
    expect(projectFindUnique).toHaveBeenCalledWith({
      where: { key: "EISC" },
      select: { id: true },
    });
  });

  it("returns the row id when found", async () => {
    projectFindUnique.mockResolvedValue({ id: "cmr_project_123" });
    const result = await resolveProjectIdByKey("EISC");
    expect(result).toBe("cmr_project_123");
  });

  it("returns null when not found", async () => {
    projectFindUnique.mockResolvedValue(null);
    const result = await resolveProjectIdByKey("NOPE");
    expect(result).toBeNull();
  });
});
