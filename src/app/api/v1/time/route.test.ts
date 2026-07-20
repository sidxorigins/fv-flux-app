import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
vi.mock("@/lib/api-auth", () => ({ authenticateApiKey: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { task: { findUnique: vi.fn() } } }));
vi.mock("@/features/time/service", () => ({ logTimeForUser: vi.fn() }));
import { authenticateApiKey } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { logTimeForUser } from "@/features/time/service";
import { POST } from "./route";
const auth = authenticateApiKey as unknown as Mock;
const db = prisma as unknown as { task: { findUnique: Mock } };
function post(b: unknown) { return new Request("https://x/api/v1/time", { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } }); }
beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ actor: { id: "u1" } }); db.task.findUnique.mockResolvedValue({ id: "t1" }); (logTimeForUser as unknown as Mock).mockResolvedValue({ id: "te1" }); });
describe("POST /api/v1/time", () => {
  it("401 unauth", async () => { auth.mockResolvedValue({ error: { status: 401, code: "x", message: "x" } }); expect((await POST(post({ taskId: "t1", minutes: 30 }))).status).toBe(401); });
  it("404 missing task", async () => { db.task.findUnique.mockResolvedValue(null); expect((await POST(post({ taskId: "n", minutes: 30 }))).status).toBe(404); });
  it("400 invalid minutes", async () => { expect((await POST(post({ taskId: "t1", minutes: 0 }))).status).toBe(400); });
  it("201 logs time", async () => { const r = await POST(post({ taskId: "t1", minutes: 30 })); expect(r.status).toBe(201); expect((await r.json()).entry.id).toBe("te1"); });
});
