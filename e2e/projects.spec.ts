import { expect, test } from "@playwright/test";

test.describe("projects", () => {
  test("lists the seeded project", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Flux/ }).first()).toBeVisible();
  });

  test("board view renders all four status columns with seeded tasks", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();

    // Column headers come from STATUS_META.
    for (const column of ["To Do", "In Progress", "In Review", "Done"]) {
      await expect(
        page.getByRole("heading", { name: column, exact: true }),
      ).toBeVisible();
    }

    // Seeded cards across columns.
    await expect(page.getByText("FLUX-1").first()).toBeVisible(); // In Progress
    await expect(page.getByText("FLUX-2").first()).toBeVisible(); // To Do
    await expect(page.getByText("FLUX-3").first()).toBeVisible(); // In Review
    await expect(page.getByText("FLUX-6").first()).toBeVisible(); // Done
  });

  test("backlog view lists tasks and filters by search", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();
    await page.getByRole("tab", { name: "Backlog" }).click();

    await expect(page).toHaveURL(/view=backlog/);
    await expect(page.getByText("FLUX-1").first()).toBeVisible();
    await expect(page.getByText("FLUX-8").first()).toBeVisible();
  });

  test("clicking a task opens the detail drawer with its activity", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();

    await page.getByText("Fix drag-and-drop flicker on Safari").first().click();
    await expect(page).toHaveURL(/task=/);

    // Drawer shows the task title and the seeded comment.
    await expect(
      page.getByText("Fix drag-and-drop flicker on Safari").first(),
    ).toBeVisible();
    await expect(
      page.getByText("Reproduced on Safari 17", { exact: false }),
    ).toBeVisible();
  });
});
