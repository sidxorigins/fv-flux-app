import { expect, test } from "@playwright/test";

test.describe("task creation", () => {
  test("creates a task from the backlog and sees it appear", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();
    await page.getByRole("tab", { name: "Backlog" }).click();

    // Unique title so re-runs against the same dev DB never collide.
    const title = `E2E task ${Date.now()}`;

    await page.getByRole("button", { name: "New task" }).click();
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();

    // Dialog closes and the new task shows up in the backlog list.
    await expect(page.getByRole("heading", { name: "New task" })).toBeHidden();
    await expect(page.getByText(title).first()).toBeVisible();
  });
});
