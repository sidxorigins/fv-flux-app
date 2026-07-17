import { expect, test } from "@playwright/test";

async function openBoard(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.getByRole("link", { name: /Flux/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "To Do", exact: true }),
  ).toBeVisible();
}

test.describe("board quick-add", () => {
  test("creates a task inline in a column", async ({ page }) => {
    await openBoard(page);

    const title = `QuickAdd ${Date.now()}`;
    const input = page.getByPlaceholder(/Add a task/i).first();
    await expect(input).toBeVisible();
    await input.fill(title);
    await input.press("Enter");

    await expect(page.getByText(title).first()).toBeVisible();
  });
});

test.describe("backlog sorting", () => {
  test("sorting by priority orders urgent-first and reflects in the URL", async ({
    page,
  }) => {
    await openBoard(page);
    await page.getByRole("tab", { name: "Backlog" }).click();

    await page.getByRole("button", { name: /Priority/i }).first().click();
    await expect(page).toHaveURL(/sort=priority/);

    // The first data row should be the urgent seeded bug (FLUX-3).
    const firstRowKey = page.locator("tbody tr").first();
    await expect(firstRowKey).toContainText("FLUX-3");
  });

  test("the sortable Updated column is present", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("tab", { name: "Backlog" }).click();
    await expect(
      page.getByRole("button", { name: /Updated/i }).first(),
    ).toBeVisible();
  });
});
