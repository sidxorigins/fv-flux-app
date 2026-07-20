import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permissions", () => {
  class AuthorizationError extends Error {
    readonly code: string;
    constructor(c: string) { super(c); this.name = "AuthorizationError"; this.code = c; }
  }
  return { AuthorizationError, requireUser: vi.fn() };
});
vi.mock("@/lib/db", () => ({ prisma: { user: { update: vi.fn() } } }));

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { completeTour } from "./actions";

const update = (prisma as unknown as { user: { update: Mock } }).user.update;
const mockUser = requireUser as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.mockResolvedValue({ id: "u1", tourCompletedAt: null });
  update.mockResolvedValue({});
});

describe("completeTour", () => {
  it("sets tourCompletedAt for the signed-in user only", async () => {
    const res = await completeTour();
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" } }),
    );
    const data = update.mock.calls[0][0].data;
    expect(data.tourCompletedAt).toBeInstanceOf(Date);
  });

  it("is a no-op when already completed (no write)", async () => {
    mockUser.mockResolvedValue({ id: "u1", tourCompletedAt: new Date() });
    const res = await completeTour();
    expect(res).toEqual({ ok: true });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects when unauthenticated", async () => {
    const { AuthorizationError } = await import("@/lib/permissions");
    mockUser.mockRejectedValue(new AuthorizationError("UNAUTHENTICATED"));
    const res = await completeTour();
    expect(res.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
