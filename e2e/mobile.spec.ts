import { expect, test } from "@playwright/test";

// Mobile-specific behaviour: the sidebar is hidden below lg and the topbar
// hamburger opens a navigation sheet instead.
test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("hamburger opens the nav sheet and navigating closes it", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const hamburger = page.getByRole("button", { name: "Open navigation" });
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    const projectsLink = page.getByRole("link", { name: "Projects" });
    await expect(projectsLink).toBeVisible();
    await projectsLink.click();

    await expect(page).toHaveURL(/\/projects/);
    // Sheet closed itself — its other links are gone.
    await expect(page.getByRole("link", { name: "My Tasks" })).toBeHidden();
  });

  test("the window never pans horizontally on the board", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();
    await expect(
      page.getByRole("heading", { name: "To Do", exact: true }),
    ).toBeVisible();

    // Horizontal wheel/touch pan on page chrome must not move the window —
    // (programmatic scrollTo still works under overflow-x: hidden, so this
    // simulates the user gesture instead).
    await page.mouse.move(195, 120);
    await page.mouse.wheel(400, 0);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
});
