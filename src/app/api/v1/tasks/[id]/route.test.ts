import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/api-auth", () => ({ authenticateApiKey: vi.fn() }));
vi.mock("@/features/tasks/service", () => ({ setTaskStatusForActor: vi.fn() }));

import { authenticateApiKey } from "@/lib/api-auth";
import { setTaskStatusForActor } from "@/features/tasks/service";
import { PATCH } from "./route";

const auth = authenticateApiKey as unknown as Mock;
const setStatus = setTaskStatusForActor as unknown as Mock;

function patch(body: unknown): Request {
  return new Request("https://x/api/v1/tasks/t1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const params = Promise.resolve({ id: "t1" });

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ actor: { id: "actor-1" } });
  setStatus.mockResolvedValue({ id: "t1", key: "FFD-1", status: "DONE" });
});

describe("PATCH /api/v1/tasks/{id}", () => {
  it("401 when unauthenticated", async () => {
    auth.mockResolvedValue({ error: { status: 401, code: "unauthenticated", message: "no" } });
    const res = await PATCH(patch({ status: "DONE" }), { params });
    expect(res.status).toBe(401);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("400 on an invalid status", async () => {
    const res = await PATCH(patch({ status: "SHIPPED" }), { params });
    expect(res.status).toBe(400);
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("404 when the task doesn't exist", async () => {
    setStatus.mockResolvedValue(null);
    const res = await PATCH(patch({ status: "DONE" }), { params });
    expect(res.status).toBe(404);
  });

  it("200 sets the status (attributed to the actor)", async () => {
    const res = await PATCH(patch({ status: "DONE" }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.task).toEqual({ id: "t1", key: "FFD-1", status: "DONE" });
    expect(setStatus).toHaveBeenCalledWith("actor-1", "t1", "DONE");
  });
});
