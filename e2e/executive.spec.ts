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

  test("KPI values are server-rendered, not filled in after hydration", async ({
    page,
  }) => {
    // Assert against the RAW HTML response, not the hydrated DOM. Checking the
    // DOM would prove nothing about the fast-first requirement: Playwright's
    // visibility checks ignore opacity, so a value faded in by the entrance
    // tween — or fetched client-side — would satisfy them just as well. The
    // response body can only contain these numbers if the server produced them.
    const response = await page.goto("/executive");
    const html = await response!.text();

    expect(html).toContain("Open work");
    // Every KPI label is followed by its value in the same card markup, after
    // an inline lucide-react icon `<svg>` (each path/rect quoted, so it holds
    // no bare digit text node) — 800 chars comfortably clears the longest icon
    // (verified against the live response: value offsets ranged 466-614).
    for (const label of ["Open work", "Completed this week", "Overdue", "In review"]) {
      const after = html.slice(html.indexOf(label), html.indexOf(label) + 800);
      expect(after).toMatch(/>\s*\d+\s*</);
    }
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
// A plain-USER redirect away from /executive is likewise uncovered, for the
// same reason as (2). All of these need a second, non-admin storage state,
// which is out of scope for this plan.
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
