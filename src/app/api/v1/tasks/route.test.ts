import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/api-auth", () => ({ authenticateApiKey: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { project: { findUnique: vi.fn() }, user: { findUnique: vi.fn() }, $transaction: vi.fn() },
}));
vi.mock("@/features/tasks/service", () => ({ createTaskCore: vi.fn() }));

import { authenticateApiKey } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { POST } from "./route";

const auth = authenticateApiKey as unknown as Mock;
const db = prisma as unknown as { project: { findUnique: Mock }; user: { findUnique: Mock }; $transaction: Mock };

function post(body: unknown): Request {
  return new Request("https://x/api/v1/tasks", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ actor: { id: "actor-1" } });
  db.project.findUnique.mockResolvedValue({ id: "p1" });
  db.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
});

describe("POST /api/v1/tasks", () => {
  it("401 when unauthenticated", async () => {
    auth.mockResolvedValue({ error: { status: 401, code: "unauthenticated", message: "no" } });
    const res = await POST(post({ projectId: "p1", title: "x" }));
    expect(res.status).toBe(401);
  });
  it("404 when the project is missing", async () => {
    db.project.findUnique.mockResolvedValue(null);
    const res = await POST(post({ projectId: "nope", title: "x" }));
    expect(res.status).toBe(404);
  });
  it("201 with the created task (global scope — actor need not be a member)", async () => {
    const { createTaskCore } = await import("@/features/tasks/service");
    (createTaskCore as unknown as Mock).mockResolvedValue({ id: "t1", key: "FFD-1" });
    const res = await POST(post({ projectId: "p1", title: "Ship it" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.task.key).toBe("FFD-1");
  });
});
