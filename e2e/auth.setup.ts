import { expect, test as setup } from "@playwright/test";

import { ADMIN_STORAGE_STATE } from "../playwright.config";
import { ADMIN_EMAIL, ADMIN_PASSWORD, requireCredentials } from "./helpers";

// Signs in through the real login form once and persists the session cookie
// for every authed spec (see the `chromium` project in playwright.config.ts).
setup("authenticate as seeded admin", async ({ page }) => {
  requireCredentials();

  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
