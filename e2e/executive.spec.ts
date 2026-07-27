import { expect, test } from "@playwright/test";

test.describe("executive overview", () => {
  test("an admin can reach the overview and sees org-wide sections", async ({ page }) => {
    await page.goto("/executive");

    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    await expect(page.getByText("Open work")).toBeVisible();
    await expect(page.getByText("Completed this week")).toBeVisible();
    await expect(page.getByText("Needs attention")).toBeVisible();
    await expect(page.getByText("People & workload")).toBeVisible();
  });

  test("the Overview nav link is present for an admin", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  });

  test("KPI numbers are readable immediately, not animated in", async ({ page }) => {
    await page.goto("/executive");
    // The value is server-rendered — assert it is non-empty on first paint.
    const openCard = page.locator("div").filter({ hasText: /^Open work/ }).first();
    await expect(openCard).toContainText(/\d/);
  });
});

// Coverage limit, stated deliberately: the e2e suite has exactly one stored
// session — the seeded admin (e2e/auth.setup.ts -> ADMIN_STORAGE_STATE). Two
// cases from the spec's test list therefore cannot be asserted end-to-end and
// are NOT covered here:
//
// 1. "A plain USER is redirected away from /executive." Covered by unit tests
//    instead — requireExecutive rejects USER with FORBIDDEN (Task 2) — and the
//    proxy.ts branch is a two-line mirror of the already-proven /admin branch.
// 2. "A project card without membership is not a link." An admin passes
//    getExecutiveScope's bypass, so canOpen is true for every card in this
//    session, and the locked state never renders.
//
// Both need a second, non-admin storage state, which is out of scope for this
// plan. Do not silently skip them, and do not pretend they are covered.
//
// What *is* verifiable without new fixtures is the anonymous gate:
test.describe("executive overview — access control", () => {
  // Anonymous context: no stored session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an anonymous visitor is sent to login with a callback", async ({ page }) => {
    await page.goto("/executive");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fexecutive/);
  });
});
