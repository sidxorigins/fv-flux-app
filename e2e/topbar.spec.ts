import { expect, test } from "@playwright/test";

import { ADMIN_EMAIL } from "./helpers";

// Regression coverage for the account dropdown — a Base UI GroupLabel used
// outside a Group crashed the whole page on open (error boundary swallowed it).
test.describe("topbar account menu", () => {
  test("opens and shows the signed-in identity", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Account menu" }).click();

    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByText(ADMIN_EMAIL)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("Profile item navigates to the profile page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Profile" }).click();

    await expect(page).toHaveURL(/\/profile/);
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  });

  test("Sign out ends the session and lands on /login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login/);
    // Session really gone: a protected route bounces back to /login.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
