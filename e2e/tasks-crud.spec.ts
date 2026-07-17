import { expect, test } from "@playwright/test";

test.describe("task creation", () => {
  test("creates a task from the backlog and sees it appear", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();
    await page.getByRole("tab", { name: "Backlog" }).click();

    // Unique title so re-runs against the same dev DB never collide.
    const title = `E2E task ${Date.now()}`;

    await page.getByRole("button", { name: "New task" }).click();
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();

    // Dialog closes and the new task shows up in the backlog list.
    await expect(page.getByRole("heading", { name: "New task" })).toBeHidden();
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test("creates a task from the board view", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();
    // Board is the default view — the New task button lives beside the tabs.
    await expect(
      page.getByRole("heading", { name: "To Do", exact: true }),
    ).toBeVisible();

    const title = `Board task ${Date.now()}`;
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();

    await expect(page.getByRole("heading", { name: "New task" })).toBeHidden();
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test("creates a task from My Tasks with a project picker", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "My Tasks" })).toBeVisible();

    const title = `My Tasks task ${Date.now()}`;
    await page.getByRole("button", { name: "New task" }).click();
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    // Multi-project mode exposes a Project select.
    await expect(page.getByLabel("Project")).toBeVisible();
    await page.getByLabel("Title").fill(title);
    // Assign to self so it lands on this very page.
    await page.getByLabel("Assignee").click();
    await page.getByRole("option", { name: "Flux Admin" }).click();
    await page.getByRole("button", { name: "Create task" }).click();

    await expect(page.getByRole("heading", { name: "New task" })).toBeHidden();
    await expect(page.getByText(title).first()).toBeVisible();
  });
});
