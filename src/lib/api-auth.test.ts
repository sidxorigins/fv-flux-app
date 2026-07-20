import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { apiKey: { findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock("./rate-limit", () => ({ rateLimit: vi.fn(() => ({ ok: true, retryAfterMs: 0, remaining: 1 })) }));

import { prisma } from "@/lib/db";
import { rateLimit } from "./rate-limit";
import { authenticateApiKey } from "./api-auth";
import { generateApiKey } from "./api-key";

const findUnique = (prisma as unknown as { apiKey: { findUnique: Mock; update: Mock } }).apiKey.findUnique;
const update = (prisma as unknown as { apiKey: { update: Mock } }).apiKey.update;

function req(auth?: string): Request {
  return new Request("https://x/api/v1/x", { headers: auth ? { authorization: auth } : {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
  (rateLimit as unknown as Mock).mockReturnValue({ ok: true, retryAfterMs: 0, remaining: 1 });
});

describe("authenticateApiKey", () => {
  it("401 on missing/malformed header", async () => {
    const r = await authenticateApiKey(req());
    expect("error" in r && r.error.status).toBe(401);
  });
  it("401 on unknown key", async () => {
    findUnique.mockResolvedValue(null);
    const r = await authenticateApiKey(req(`Bearer ${generateApiKey().key}`));
    expect("error" in r && r.error.status).toBe(401);
  });
  it("401 on revoked key", async () => {
    findUnique.mockResolvedValue({ id: "k", prefix: "p", revokedAt: new Date(), user: { status: "ACTIVE" } });
    const r = await authenticateApiKey(req(`Bearer ${generateApiKey().key}`));
    expect("error" in r && r.error.status).toBe(401);
  });
  it("403 when the actor is not ACTIVE", async () => {
    findUnique.mockResolvedValue({ id: "k", prefix: "p", revokedAt: null, user: { status: "SUSPENDED" } });
    const r = await authenticateApiKey(req(`Bearer ${generateApiKey().key}`));
    expect("error" in r && r.error.status).toBe(403);
  });
  it("returns the actor on a valid key", async () => {
    const user = { id: "u1", status: "ACTIVE" };
    findUnique.mockResolvedValue({ id: "k", prefix: "p", revokedAt: null, user });
    const r = await authenticateApiKey(req(`Bearer ${generateApiKey().key}`));
    expect("actor" in r && r.actor).toBe(user);
  });
});
