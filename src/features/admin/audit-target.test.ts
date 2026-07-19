import { describe, expect, it } from "vitest";
import { buildTargetLabel, type AuditTargetLookups } from "./audit-target";

const lookups: AuditTargetLookups = {
  users: new Map([["u1", { name: "Jane Doe", username: "jane" }]]),
  projects: new Map([["p1", { key: "OPS", name: "Operations" }]]),
  tasks: new Map([["t1", { key: "OPS-42" }]]),
  invites: new Map([["i1", { email: "new@acme.io" }]]),
  memberships: new Map([
    ["m1", { userName: "Jane Doe", username: "jane", projectKey: "OPS" }],
  ]),
};

describe("buildTargetLabel", () => {
  it("resolves a User target to name + @username", () => {
    expect(buildTargetLabel("User", "u1", lookups)).toBe("Jane Doe @jane");
  });
  it("resolves a Project target to key — name", () => {
    expect(buildTargetLabel("Project", "p1", lookups)).toBe("OPS — Operations");
  });
  it("resolves a Task target to its key", () => {
    expect(buildTargetLabel("Task", "t1", lookups)).toBe("OPS-42");
  });
  it("resolves an Invite target to its email", () => {
    expect(buildTargetLabel("Invite", "i1", lookups)).toBe("new@acme.io");
  });
  it("resolves a ProjectMembership to user @username · project", () => {
    expect(buildTargetLabel("ProjectMembership", "m1", lookups)).toBe(
      "Jane Doe @jane · OPS",
    );
  });
  it("falls back to the raw id for a deleted/unknown target", () => {
    expect(buildTargetLabel("User", "gone", lookups)).toBe("gone");
    expect(buildTargetLabel("Comment", "c1", lookups)).toBe("c1");
  });
});
