import { expect, test } from "@playwright/test";

// Placeholder smoke test — expand as real pages come online.
// Skipped by default since scaffolding has no dev server running in CI yet;
// unskip once the app has real routes to verify.
test.skip("homepage responds", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
});
