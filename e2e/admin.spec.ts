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

  // The user id is what /api/v1 takes as `assigneeId`; it is surfaced nowhere
  // else in the UI, so an admin wiring up an integration depends on these two
  // affordances. Clipboard reads need a permission grant, so this asserts the
  // menu item and the readable id rather than the clipboard contents.
  test("a user's id is readable on their detail page and copyable from the row menu", async ({
    page,
  }) => {
    await page.goto("/admin/users");

    await page.getByRole("button", { name: "Actions for Flux Admin" }).click();
    await expect(page.getByRole("menuitem", { name: "Copy user ID" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("link", { name: /Flux Admin/ }).first().click();
    await expect(page).toHaveURL(/\/admin\/users\/[a-z0-9]+$/);

    const id = page.url().split("/").pop()!;
    await expect(page.getByText("User ID")).toBeVisible();
    await expect(page.getByText(id, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy user ID" })).toBeVisible();
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
