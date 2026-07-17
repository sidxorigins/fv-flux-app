import { expect, test } from "@playwright/test";

test.describe("my tasks", () => {
  test("lists tasks assigned to me grouped by project", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "My Tasks" })).toBeVisible();

    // Seeded assignments for the admin: FLUX-1, FLUX-3, FLUX-5, FLUX-8, FLUX-9.
    await expect(page.getByText("FLUX-1").first()).toBeVisible();
    await expect(page.getByText("FLUX-3").first()).toBeVisible();
  });
});
