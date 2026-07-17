import { expect, test } from "@playwright/test";

async function openProject(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.getByRole("link", { name: /Flux/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "To Do", exact: true }),
  ).toBeVisible();
}

test.describe("board filtering", () => {
  test("the filter bar narrows the board", async ({ page }) => {
    await openProject(page);
    await expect(page.getByPlaceholder(/Search title or key/i)).toBeVisible();

    const before = await page.locator("[data-slot='task-card']").count();
    const url = page.url();
    await page.goto(`${url}?priority=URGENT`);
    await expect(
      page.getByRole("heading", { name: "To Do", exact: true }),
    ).toBeVisible();
    const after = await page.locator("[data-slot='task-card']").count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });
});

test.describe("bulk actions", () => {
  test("selecting rows shows a bulk toolbar", async ({ page }) => {
    await openProject(page);
    await page.getByRole("tab", { name: "Backlog" }).click();

    // First data-row checkbox (index 0 is the header select-all).
    await page.getByRole("checkbox").nth(1).click();
    await expect(page.getByText(/1 selected/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Set status/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Delete/i })).toBeVisible();
  });
});

test.describe("saved views", () => {
  test("save a view and see it listed", async ({ page }) => {
    await openProject(page);
    await page.getByRole("tab", { name: "Backlog" }).click();
    await expect(page.getByPlaceholder(/Search title or key/i)).toBeVisible();

    await page.getByRole("button", { name: "Saved views" }).click();
    await page.getByRole("button", { name: /Save current view/i }).click();
    const name = `View ${Date.now()}`;
    await page.getByLabel("New view name").fill(name);
    await page.getByRole("button", { name: "Save view" }).click();

    // Reopen the popover — the saved view is listed.
    await page.getByRole("button", { name: "Saved views" }).click();
    await expect(page.getByText(name)).toBeVisible();
  });
});

test.describe("mobile board", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows a single-column status switcher", async ({ page }) => {
    await openProject(page);
    await expect(
      page.getByRole("tablist", { name: "Board column" }),
    ).toBeVisible();
  });
});
