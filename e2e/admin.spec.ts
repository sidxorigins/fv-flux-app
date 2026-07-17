import { expect, test } from "@playwright/test";

test.describe("admin area", () => {
  test("admin shell renders with all four tabs", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    for (const tab of ["Users", "Invites", "Project access", "Audit"]) {
      await expect(page.getByRole("link", { name: tab })).toBeVisible();
    }
  });

  test("users page lists the seeded admin", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByText("Flux Admin").first()).toBeVisible();
    await expect(page.getByText("it@iccadubai.ae").first()).toBeVisible();
  });

  test("project access page shows the seeded project and its members", async ({
    page,
  }) => {
    await page.goto("/admin/projects");
    await expect(page.getByText("Flux", { exact: false }).first()).toBeVisible();
  });

  test("audit page shows the seeded membership grant", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(
      page.getByText("project.member.grant", { exact: false }).first(),
    ).toBeVisible();
  });
});
