import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Next keeps secrets in .env.local; load it (best-effort) so the e2e suite can
// read the seeded admin credentials (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).
for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(path.resolve(__dirname, file));
  } catch {
    // File may not exist — ignore.
  }
}

export const ADMIN_STORAGE_STATE = path.join(__dirname, "e2e/.auth/admin.json");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "html" : [["list"]],
  // Dev-server cold compiles can take several seconds per route; don't let
  // the default 5s expect timeout flake the first navigation to each page.
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Logs in once as the seeded admin and saves the session for authed specs.
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    // Unauthenticated flows (login, redirects) — no stored session.
    {
      name: "unauthenticated",
      testMatch: /auth\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // Everything else runs with the admin session.
    {
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /auth\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: ADMIN_STORAGE_STATE,
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
