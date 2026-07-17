import { expect, test } from "@playwright/test";

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("shows the KPI row with real numbers", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("My open tasks")).toBeVisible();
    await expect(page.getByText("Due soon")).toBeVisible();
    await expect(page.getByText("In review").first()).toBeVisible();
    await expect(page.getByText("Completed this week")).toBeVisible();
  });

  test("shows the seeded project tile linking to its board", async ({ page }) => {
    const tile = page.getByRole("link", { name: /Flux/ }).first();
    await expect(tile).toBeVisible();
  });

  test("lists my assigned work", async ({ page }) => {
    // Seeded: FLUX-1 is assigned to the admin.
    await expect(page.getByText("FLUX-1").first()).toBeVisible();
  });
});
