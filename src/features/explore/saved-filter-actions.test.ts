// Mocking mirrors admin/actions.test.ts + time/actions.test.ts: @/lib/db is a
// hand-rolled mock; @/lib/permissions is a lightweight stand-in exposing a
// mockable requireUser + the real-shaped AuthorizationError.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/permissions", () => {
  class AuthorizationError extends Error {
    readonly code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthorizationError";
      this.code = code;
    }
  }
  return {
    AuthorizationError,
    requireUser: vi.fn(),
  };
});

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    savedFilter: model(),
  };
  return { prisma };
});

import { prisma } from "@/lib/db";
import { AuthorizationError, requireUser } from "@/lib/permissions";
import { createSavedFilter, deleteSavedFilter, listSavedFilters } from "./saved-filter-actions";

interface MockModel {
  findUnique: Mock;
  findMany: Mock;
  create: Mock;
  delete: Mock;
  count: Mock;
}
interface MockPrisma {
  savedFilter: MockModel;
}

const db = prisma as unknown as MockPrisma;
const mockRequireUser = requireUser as unknown as Mock;

const OWNER = { id: "user-1" };
const OTHER = { id: "user-2" };
const FILTER_ID = "filter-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireUser.mockResolvedValue(OWNER);
  db.savedFilter.count.mockResolvedValue(0);
});

describe("createSavedFilter", () => {
  it("creates a saved filter owned by the signed-in user", async () => {
    db.savedFilter.create.mockResolvedValue({ id: FILTER_ID });

    const result = await createSavedFilter({ name: "My urgent tasks", query: "priority=URGENT" });

    expect(result).toEqual({ ok: true, data: { id: FILTER_ID } });
    expect(db.savedFilter.create).toHaveBeenCalledWith({
      data: { userId: OWNER.id, name: "My urgent tasks", query: "priority=URGENT" },
      select: { id: true },
    });
  });

  it("rejects invalid input before touching the DB", async () => {
    const result = await createSavedFilter({ name: "", query: "priority=URGENT" });

    expect(result.ok).toBe(false);
    expect(db.savedFilter.create).not.toHaveBeenCalled();
  });

  it("propagates an unauthenticated caller as ok:false without touching the DB", async () => {
    mockRequireUser.mockRejectedValue(new AuthorizationError("UNAUTHENTICATED"));

    const result = await createSavedFilter({ name: "Mine", query: "status=TODO" });

    expect(result).toEqual({ ok: false, error: "You must be signed in." });
    expect(db.savedFilter.create).not.toHaveBeenCalled();
  });

  it("REFUSES to create once the caller is at the 50 saved-filter cap", async () => {
    db.savedFilter.count.mockResolvedValue(50);

    const result = await createSavedFilter({ name: "One too many", query: "status=TODO" });

    expect(result).toEqual({
      ok: false,
      error: "You've reached the maximum of 50 saved filters. Delete one first.",
    });
    expect(db.savedFilter.count).toHaveBeenCalledWith({ where: { userId: OWNER.id } });
    expect(db.savedFilter.create).not.toHaveBeenCalled();
  });
});

describe("deleteSavedFilter", () => {
  it("deletes the caller's own saved filter", async () => {
    db.savedFilter.findUnique.mockResolvedValue({ id: FILTER_ID, userId: OWNER.id });
    db.savedFilter.delete.mockResolvedValue({});

    const result = await deleteSavedFilter(FILTER_ID);

    expect(result).toEqual({ ok: true, data: { id: FILTER_ID } });
    expect(db.savedFilter.delete).toHaveBeenCalledWith({ where: { id: FILTER_ID } });
  });

  it("REFUSES to delete another user's saved filter — no delete call, ok:false", async () => {
    db.savedFilter.findUnique.mockResolvedValue({ id: FILTER_ID, userId: OTHER.id });

    const result = await deleteSavedFilter(FILTER_ID);

    expect(result).toEqual({ ok: false, error: "You can only delete your own saved filters." });
    expect(db.savedFilter.delete).not.toHaveBeenCalled();
  });

  it("returns not-found without touching delete when the row doesn't exist", async () => {
    db.savedFilter.findUnique.mockResolvedValue(null);

    const result = await deleteSavedFilter(FILTER_ID);

    expect(result).toEqual({ ok: false, error: "Saved filter not found." });
    expect(db.savedFilter.delete).not.toHaveBeenCalled();
  });

  it("rejects an empty id before touching the DB", async () => {
    const result = await deleteSavedFilter("");

    expect(result.ok).toBe(false);
    expect(db.savedFilter.findUnique).not.toHaveBeenCalled();
    expect(db.savedFilter.delete).not.toHaveBeenCalled();
  });
});

describe("listSavedFilters", () => {
  it("returns only the caller's own saved filters, most recent first", async () => {
    const rows = [
      { id: "f2", userId: OWNER.id, name: "Second", query: "status=DONE", createdAt: new Date("2026-07-20") },
      { id: "f1", userId: OWNER.id, name: "First", query: "status=TODO", createdAt: new Date("2026-07-19") },
    ];
    db.savedFilter.findMany.mockResolvedValue(rows);

    const result = await listSavedFilters();

    expect(result).toEqual({ ok: true, data: rows });
    expect(db.savedFilter.findMany).toHaveBeenCalledWith({
      where: { userId: OWNER.id },
      orderBy: { createdAt: "desc" },
    });
  });

  it("propagates an unauthenticated caller as ok:false without touching the DB", async () => {
    mockRequireUser.mockRejectedValue(new AuthorizationError("UNAUTHENTICATED"));

    const result = await listSavedFilters();

    expect(result).toEqual({ ok: false, error: "You must be signed in." });
    expect(db.savedFilter.findMany).not.toHaveBeenCalled();
  });
});
