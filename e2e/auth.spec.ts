import { expect, test } from "@playwright/test";

import { ADMIN_EMAIL, ADMIN_PASSWORD, requireCredentials } from "./helpers";

test.describe("authentication", () => {
  test("unauthenticated visitors are redirected to /login with a callbackUrl", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("the root path shows the public landing page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: /Flux/ })).toBeVisible();
    await expect(page.getByText(/Work in motion/).first()).toBeVisible();
    await expect(page.getByRole("img", { name: /Foodverse/ })).toBeVisible();

    // Sign in CTA leads to the login form (Base UI renders the link with
    // role="button" when Button wraps a Link).
    await page.getByRole("button", { name: "Sign in" }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("wrong credentials show a generic error and stay on /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const error = page.getByRole("alert");
    await expect(error).toBeVisible();
    // Deliberately generic — must not reveal whether email or password failed.
    await expect(error).not.toContainText(/email|password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("valid credentials land on the dashboard", async ({ page }) => {
    requireCredentials();

    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("login honours a safe callbackUrl", async ({ page }) => {
    requireCredentials();

    await page.goto("/login?callbackUrl=%2Fprojects");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/projects/);
  });
});
