import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permissions", () => {
  class AuthorizationError extends Error {
    readonly code: string;
    constructor(c: string) {
      super(c);
      this.name = "AuthorizationError";
      this.code = c;
    }
  }
  return { AuthorizationError, requireAdmin: vi.fn() };
});
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    apiKey: { create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";
import { createApiKey } from "./actions";

const db = prisma as unknown as {
  user: { findUnique: Mock };
  apiKey: { create: Mock };
  auditLog: { create: Mock };
};
const admin = requireAdmin as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  admin.mockResolvedValue({ id: "admin-1" });
  db.user.findUnique.mockResolvedValue({ id: "u1" });
  db.apiKey.create.mockResolvedValue({ id: "k1" });
  db.auditLog.create.mockResolvedValue({});
});

describe("createApiKey", () => {
  it("forbids non-admins", async () => {
    const { AuthorizationError } = await import("@/lib/permissions");
    admin.mockRejectedValue(new AuthorizationError("FORBIDDEN"));
    const res = await createApiKey({ name: "a", userId: "u1" });
    expect(res.ok).toBe(false);
    expect(db.apiKey.create).not.toHaveBeenCalled();
  });

  it("stores the HASH not the raw key, returns the raw key once, and audits", async () => {
    const res = await createApiKey({ name: "agent", userId: "u1" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.key.startsWith("flux_sk_")).toBe(true);
    const created = db.apiKey.create.mock.calls[0][0].data;
    expect(created.keyHash).toBeDefined();
    expect(created.key).toBeUndefined(); // never store the raw key
    if (res.ok) expect(created.keyHash).not.toBe(res.data?.key); // stored value != plaintext
    // audit written WITHOUT the raw key. Note: we check against the actual
    // generated key rather than the literal "flux_sk_" constant — every key's
    // `prefix` (a legitimate, non-secret display value shown in admin listings,
    // see queries.ts ApiKeyRow) necessarily starts with that same format marker
    // (see generateApiKey in lib/api-key.ts), so a bare substring check on the
    // constant would false-positive on the prefix itself. What must never appear
    // is the full raw secret.
    const audit = db.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe("api_key.created");
    if (res.ok) {
      expect(JSON.stringify(audit.metadata ?? {})).not.toContain(res.data!.key);
    }
  });
});
