import { describe, it, expect } from "vitest";
import {
  projectPath,
  taskDrawerPath,
  taskPagePath,
  taskShareUrl,
  isCuid,
} from "./share";

describe("url helpers", () => {
  it("projectPath uses the project key", () => {
    expect(projectPath("EISC")).toBe("/projects/EISC");
  });

  it("taskDrawerPath links to the project with a task key param", () => {
    expect(taskDrawerPath("EISC", "EISC-9")).toBe("/projects/EISC?task=EISC-9");
  });

  it("taskDrawerPath merges extra params", () => {
    expect(taskDrawerPath("EISC", "EISC-9", { view: "backlog" })).toBe(
      "/projects/EISC?view=backlog&task=EISC-9",
    );
  });

  it("taskPagePath is the flat browse route", () => {
    expect(taskPagePath("EISC-9")).toBe("/browse/EISC-9");
  });

  it("taskShareUrl is an absolute browse permalink", () => {
    expect(taskShareUrl("https://flux.foodverse.io", "EISC-9")).toBe(
      "https://flux.foodverse.io/browse/EISC-9",
    );
  });

  it("isCuid distinguishes cuids from keys", () => {
    expect(isCuid("cmrogf3wu0006pa705fts9z8o")).toBe(true);
    expect(isCuid("EISC")).toBe(false);
    expect(isCuid("EISC-9")).toBe(false);
  });
});
