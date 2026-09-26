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
    requireAdmin: vi.fn(),
    requireEventEditor: vi.fn(),
    requireUser: vi.fn(),
  };
});

vi.mock("@/lib/db", () => {
  const model = () => ({
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  });
  const prisma: Record<string, unknown> = {
    event: model(),
    eventDay: model(),
    eventSession: model(),
    eventSessionAssignment: model(),
    eventManager: model(),
    auditLog: model(),
    user: model(),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});

import { prisma } from "@/lib/db";
import { AuthorizationError, requireAdmin, requireEventEditor, requireUser } from "@/lib/permissions";
import {
  createEventFromTemplate,
  createSession,
  deleteDay,
  moveSession,
  setSessionCompleted,
  upsertAssignment,
} from "./actions";

type MockModel = Record<string, Mock>;
const db = prisma as unknown as Record<string, MockModel>;
const mockAdmin = requireAdmin as unknown as Mock;
const mockEditor = requireEventEditor as unknown as Mock;
const mockUser = requireUser as unknown as Mock;

const forbidden = () => {
  throw new AuthorizationError("FORBIDDEN");
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.mockResolvedValue({ id: "admin", globalRole: "ADMIN" });
  mockEditor.mockResolvedValue({ id: "editor", globalRole: "USER" });
  mockUser.mockResolvedValue({ id: "u1", globalRole: "USER" });
});

describe("createEventFromTemplate", () => {
  it("imports Expogast 2026 with 7 days and sessions per day", async () => {
    db.event.findUnique.mockResolvedValue(null);
    db.event.create.mockResolvedValue({ id: "ev1", slug: "expogast-2026", name: "Expogast 2026" });
    db.eventDay.create.mockImplementation(async ({ data }: { data: { date: Date } }) => ({ id: `day-${data.date.toISOString().slice(0, 10)}` }));
    db.eventSession.createMany.mockResolvedValue({ count: 1 });

    const res = await createEventFromTemplate("expogast-2026");
    expect(res.ok).toBe(true);
    expect(db.eventDay.create).toHaveBeenCalledTimes(7);
    expect(db.eventSession.createMany).toHaveBeenCalledTimes(7);
    // Timed sessions sort by clock minute; the After Party (21:00) is on Sat 21 only.
    const sat = db.eventSession.createMany.mock.calls[1][0].data as { title: string; position: number; startTime: string | null }[];
    expect(sat.some((s) => s.title === "RAK Porcelain After Party")).toBe(true);
    const sun = db.eventSession.createMany.mock.calls[2][0].data as { title: string }[];
    expect(sun.some((s) => s.title === "RAK Porcelain After Party")).toBe(false);
    const hotKitchen = sat.find((s) => s.startTime === "10:30")!;
    expect(Math.floor(hotKitchen.position)).toBe(630);
    expect(db.auditLog.create).toHaveBeenCalledOnce();
  });

  it("refuses to import twice", async () => {
    db.event.findUnique.mockResolvedValue({ id: "ev1" });
    const res = await createEventFromTemplate("expogast-2026");
    expect(res.ok).toBe(false);
    expect(db.event.create).not.toHaveBeenCalled();
  });

  it("is Admin-only", async () => {
    mockAdmin.mockImplementation(forbidden);
    const res = await createEventFromTemplate("expogast-2026");
    expect(res).toEqual({ ok: false, error: "You don't have permission to do that." });
  });

  it("rejects unknown templates", async () => {
    expect((await createEventFromTemplate("nope")).ok).toBe(false);
  });
});

describe("createSession", () => {
  beforeEach(() => {
    db.eventDay.findUnique.mockResolvedValue({ eventId: "ev1", event: { slug: "expogast-2026" } });
    db.eventSession.create.mockResolvedValue({ id: "s-new" });
  });

  it("positions timed sessions at their start minute", async () => {
    const res = await createSession({ dayId: "d1", title: "Hot Kitchen", startTime: "12:00", priority: "MUST_FILM" });
    expect(res.ok).toBe(true);
    expect(db.eventSession.create.mock.calls[0][0].data.position).toBe(720);
    expect(mockEditor).toHaveBeenCalledWith("ev1");
  });

  it("appends untimed sessions after everything on the day", async () => {
    db.eventSession.findFirst.mockResolvedValue({ position: 1500 });
    await createSession({ dayId: "d1", title: "Afternoon thing", timeLabel: "Afternoon", priority: "HIGH" });
    expect(db.eventSession.create.mock.calls[0][0].data.position).toBe(1501);
  });

  it("is refused for non-editors", async () => {
    mockEditor.mockImplementation(forbidden);
    const res = await createSession({ dayId: "d1", title: "X", priority: "HIGH" });
    expect(res.ok).toBe(false);
    expect(db.eventSession.create).not.toHaveBeenCalled();
  });

  it("rejects invalid input before touching auth", async () => {
    const res = await createSession({ dayId: "d1", title: "", priority: "HIGH" });
    expect(res.ok).toBe(false);
    expect(mockEditor).not.toHaveBeenCalled();
  });
});

describe("moveSession", () => {
  beforeEach(() => {
    db.eventSession.findUnique.mockResolvedValue({
      id: "b", dayId: "d1", eventId: "ev1", position: 200, startTime: null, event: { slug: "x" },
    });
    db.eventSession.findMany.mockResolvedValue([
      { id: "a", position: 100 },
      { id: "b", position: 200 },
      { id: "c", position: 300 },
    ]);
  });

  it("moves up to the midpoint between the two above, or before the first", async () => {
    await moveSession({ sessionId: "b", direction: "up" });
    expect(db.eventSession.update.mock.calls[0][0].data.position).toBeLessThan(100);
  });

  it("moves down to the midpoint between the two below, or after the last", async () => {
    await moveSession({ sessionId: "b", direction: "down" });
    expect(db.eventSession.update.mock.calls[0][0].data.position).toBeGreaterThan(300);
  });

  it("moves between neighbours when there are two beyond", async () => {
    db.eventSession.findMany.mockResolvedValue([
      { id: "a", position: 100 },
      { id: "b", position: 200 },
      { id: "c", position: 300 },
      { id: "d", position: 400 },
    ]);
    await moveSession({ sessionId: "b", direction: "down" });
    expect(db.eventSession.update.mock.calls[0][0].data.position).toBe(350);
  });

  it("is a no-op at the edge", async () => {
    db.eventSession.findUnique.mockResolvedValue({
      id: "a", dayId: "d1", eventId: "ev1", position: 100, startTime: null, event: { slug: "x" },
    });
    const res = await moveSession({ sessionId: "a", direction: "up" });
    expect(res.ok).toBe(true);
    expect(db.eventSession.update).not.toHaveBeenCalled();
  });
});

describe("setSessionCompleted", () => {
  const base = { eventId: "ev1", ownerId: "someone-else", event: { slug: "x", managers: [] }, assignments: [] };

  it("lets the owner mark done", async () => {
    db.eventSession.findUnique.mockResolvedValue({ ...base, ownerId: "u1" });
    const res = await setSessionCompleted({ sessionId: "s1", completed: true });
    expect(res.ok).toBe(true);
    expect(db.eventSession.update.mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
  });

  it("lets crew mark done", async () => {
    db.eventSession.findUnique.mockResolvedValue({ ...base, assignments: [{ id: "a1" }] });
    expect((await setSessionCompleted({ sessionId: "s1", completed: true })).ok).toBe(true);
  });

  it("refuses bystanders", async () => {
    db.eventSession.findUnique.mockResolvedValue(base);
    const res = await setSessionCompleted({ sessionId: "s1", completed: true });
    expect(res.ok).toBe(false);
    expect(db.eventSession.update).not.toHaveBeenCalled();
  });

  it("clears completedAt on undo", async () => {
    mockUser.mockResolvedValue({ id: "adm", globalRole: "ADMIN" });
    db.eventSession.findUnique.mockResolvedValue(base);
    await setSessionCompleted({ sessionId: "s1", completed: false });
    expect(db.eventSession.update.mock.calls[0][0].data.completedAt).toBeNull();
  });
});

describe("upsertAssignment", () => {
  beforeEach(() => {
    db.eventSession.findUnique.mockResolvedValue({ id: "s1", dayId: "d1", eventId: "ev1", position: 1, startTime: null, event: { slug: "x" } });
  });

  it("adds an ACTIVE user with a role", async () => {
    db.user.findUnique.mockResolvedValue({ status: "ACTIVE" });
    const res = await upsertAssignment({ sessionId: "s1", userId: "u9", role: "Camera A" });
    expect(res.ok).toBe(true);
    expect(db.eventSessionAssignment.upsert.mock.calls[0][0].create.role).toBe("Camera A");
  });

  it("refuses suspended users", async () => {
    db.user.findUnique.mockResolvedValue({ status: "SUSPENDED" });
    const res = await upsertAssignment({ sessionId: "s1", userId: "u9", role: "" });
    expect(res.ok).toBe(false);
    expect(db.eventSessionAssignment.upsert).not.toHaveBeenCalled();
  });
});

describe("deleteDay", () => {
  it("keeps at least one day", async () => {
    db.eventDay.findUnique.mockResolvedValue({ eventId: "ev1", event: { slug: "x", _count: { days: 1 } } });
    const res = await deleteDay({ dayId: "d1" });
    expect(res.ok).toBe(false);
    expect(db.eventDay.delete).not.toHaveBeenCalled();
  });

  it("deletes when more than one day remains", async () => {
    db.eventDay.findUnique.mockResolvedValue({ eventId: "ev1", event: { slug: "x", _count: { days: 7 } } });
    const res = await deleteDay({ dayId: "d1" });
    expect(res.ok).toBe(true);
    expect(db.eventDay.delete).toHaveBeenCalledOnce();
  });
});
