import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/api-auth", () => ({ authenticateApiKey: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findMany: vi.fn() } } }));

import { authenticateApiKey } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { GET } from "./route";

const auth = authenticateApiKey as unknown as Mock;
const db = prisma as unknown as { user: { findMany: Mock } };

function get(query = ""): Request {
  return new Request(`https://x/api/v1/users${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ actor: { id: "actor-1" } });
  db.user.findMany.mockResolvedValue([
    { id: "u1", name: "Ada", username: "ada", email: "ada@x.io", status: "ACTIVE" },
  ]);
});

describe("GET /api/v1/users", () => {
  it("401 when unauthenticated", async () => {
    auth.mockResolvedValue({ error: { status: 401, code: "unauthenticated", message: "no" } });
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("200 with the assignable directory, excluding SUSPENDED users", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect((await res.json()).users[0].id).toBe("u1");
    const args = db.user.findMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ not: "SUSPENDED" });
    expect(args.take).toBe(200);
  });

  it("never selects the password hash or any secret column", async () => {
    await GET(get());
    expect(db.user.findMany.mock.calls[0][0].select).toEqual({
      id: true, name: true, username: true, email: true, status: true,
    });
  });

  it("q filters case-insensitively across name, username and email", async () => {
    await GET(get("?q=ada"));
    const where = db.user.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { name: { contains: "ada", mode: "insensitive" } },
      { username: { contains: "ada", mode: "insensitive" } },
      { email: { contains: "ada", mode: "insensitive" } },
    ]);
  });

  it("400 invalid_query when q is over the length cap", async () => {
    const res = await GET(get(`?q=${"a".repeat(201)}`));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_query");
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
