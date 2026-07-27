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
});

test.describe("executive overview — server-rendered content", () => {
  // JavaScript disabled: no hydration, no client fetch, and the GSAP entrance
  // tween never runs. Whatever the browser shows is exactly what the server
  // sent, so ordinary DOM assertions become a real test of the fast-first
  // requirement — and they stay scoped to the element under test.
  //
  // This replaces an earlier attempt that sliced the raw HTML response by
  // character offset. That approach could not bound its own search: the window
  // needed to clear each card's inline SVG icon, but a window that wide reached
  // past the last KPI card into ThroughputSpark's headline number, so a card
  // rendering NO value could still have matched a digit belonging to a
  // different component.
  test.use({ javaScriptEnabled: false });

  test("every KPI card renders its value from the server", async ({ page }) => {
    await page.goto("/executive");

    const kpis = page.locator('[data-tour="executive-kpis"]');
    await expect(kpis).toBeVisible();

    for (const label of [
      "Open work",
      "Completed this week",
      "Overdue",
      "In review",
    ]) {
      const card = kpis.locator(".glass").filter({ hasText: label });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(/\d/);
    }
  });

  test("the project board renders from the server", async ({ page }) => {
    await page.goto("/executive");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Needs attention")).toBeVisible();
  });
});

// Coverage limit, stated deliberately: this suite has exactly one stored
// session — the seeded admin (e2e/auth.setup.ts → ADMIN_STORAGE_STATE). All
// three of the design spec's e2e cases therefore cannot be asserted as written:
//
//  1. "An EXECUTIVE signs in and lands on /executive." Substituted with an
//     admin-reachability test — an admin passes the same guard, so the route,
//     the queries and the render are exercised, but the EXECUTIVE-specific
//     landing redirect is not. Backstopped by defaultLandingPath's per-role
//     unit tests in src/lib/landing.test.ts.
//  2. "Navigating to /admin redirects an EXECUTIVE to /dashboard." Untestable
//     with an admin session, which is ALLOWED into /admin. Backstopped by
//     requireAdmin rejecting EXECUTIVE in src/lib/permissions.test.ts, and the
//     proxy.ts branch is a two-line mirror of the already-proven /admin branch.
//  3. "A project card without membership is not a link." An admin passes
//     getExecutiveScope's bypass, so canOpen is true for every card in this
//     session and the locked state never renders.
//
// A plain-USER redirect away from /executive is likewise uncovered. Backstopped
// by requireExecutive rejecting USER with FORBIDDEN in
// src/lib/permissions.test.ts — a different function from (2)'s requireAdmin,
// so it needs its own citation. All of these need a second, non-admin storage
// state, which is out of scope for this plan.
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
