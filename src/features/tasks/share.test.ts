import { describe, it, expect } from "vitest";
import { taskShareUrl } from "./share";

describe("taskShareUrl", () => {
  it("builds the task deep link from origin + ids", () => {
    expect(taskShareUrl("https://flux.foodverse.io", "p1", "t1")).toBe(
      "https://flux.foodverse.io/projects/p1?task=t1",
    );
  });

  it("works for localhost origins (no trailing slash duplication)", () => {
    expect(taskShareUrl("http://localhost:3000", "proj_abc", "task_xyz")).toBe(
      "http://localhost:3000/projects/proj_abc?task=task_xyz",
    );
  });
});
