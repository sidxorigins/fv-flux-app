import { expect, test } from "@playwright/test";

test.describe("notifications", () => {
  test("the notification bell is present and opens", async ({ page }) => {
    await page.goto("/dashboard");
    const bell = page.getByRole("button", { name: /Notifications/ });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(
      page.getByRole("menu").getByText("Notifications", { exact: true }),
    ).toBeVisible();
  });

  test("a task can be watched and unwatched from the drawer", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();
    await expect(
      page.getByRole("heading", { name: "To Do", exact: true }),
    ).toBeVisible();
    await page.getByText("Design the Kanban board layout").first().click();

    const dialog = page.getByRole("dialog");
    const watch = dialog.getByRole("button", { name: /Watch/ });
    await expect(watch).toBeVisible();
    const before = (await watch.textContent())?.trim();

    await watch.click();
    // Label flips between "Watch" and "Watching".
    await expect(watch).not.toHaveText(before ?? "");

    // Toggle back so the test is idempotent against the shared seed.
    await watch.click();
    await expect(watch).toHaveText(before ?? "Watch");
  });
});
