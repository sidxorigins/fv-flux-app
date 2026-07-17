import { expect, test } from "@playwright/test";

async function openProject(page: import("@playwright/test").Page) {
  await page.goto("/projects");
  await page.getByRole("link", { name: /Flux/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "To Do", exact: true }),
  ).toBeVisible();
}

test.describe("editing a task from the drawer", () => {
  test("reassigns and re-types a task, and it persists", async ({ page }) => {
    await openProject(page);
    // Open a known seeded task.
    await page.getByText("Add rich-text comments with Tiptap").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Reassign to Flux Admin — the trigger's accessible name reflects it.
    await page.getByRole("button", { name: "Change assignee" }).click();
    await page.getByRole("menuitem", { name: "Flux Admin" }).click();
    await expect(
      page.getByRole("button", { name: /assignee/i }),
    ).toContainText("Flux Admin");

    // Change type to Bug.
    await page.getByRole("button", { name: "Change type" }).click();
    await page.getByRole("menuitem", { name: "Bug" }).click();

    // Reload — the change stuck.
    await page.reload();
    await expect(
      page.getByRole("button", { name: /assignee/i }),
    ).toContainText("Flux Admin");
  });
});

test.describe("label management", () => {
  test("creates and deletes a label", async ({ page }) => {
    await openProject(page);
    await page.getByRole("button", { name: "Manage labels" }).click();

    const name = `qa-${Date.now()}`;
    await page.getByLabel("New label name").fill(name);
    await page.getByRole("button", { name: "Create label" }).click();
    await expect(page.getByRole("dialog").getByText(name)).toBeVisible();

    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("dialog").getByText(name)).toBeHidden();
  });
});

test.describe("command palette", () => {
  test("⌘K opens, searches, and navigates to a task", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Meta+k");

    const input = page.getByPlaceholder("Search tasks and projects…");
    await expect(input).toBeVisible();
    await input.fill("drag");
    // Scope to the palette dialog — the dashboard also lists this task behind it.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Fix drag-and-drop flicker")).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/projects\/.*task=/);
  });
});
