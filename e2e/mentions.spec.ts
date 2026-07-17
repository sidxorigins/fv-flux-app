import { expect, test } from "@playwright/test";

test.describe("@-mention autocomplete", () => {
  test("typing @ in a comment shows the member picker and inserts a mention", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();
    await expect(
      page.getByRole("heading", { name: "To Do", exact: true }),
    ).toBeVisible();
    await page.getByText("Fix drag-and-drop flicker on Safari").first().click();

    const dialog = page.getByRole("dialog");
    const editor = dialog.locator('[contenteditable="true"]').last();
    await editor.click();
    await editor.pressSequentially("hey @sam", { delay: 50 });

    // The suggestion popup lists the seeded member Sam Rivera (@sam).
    await expect(
      page.getByRole("button", { name: /Sam Rivera @sam/ }),
    ).toBeVisible();

    // Enter selects it — a highlighted mention chip is inserted.
    await page.keyboard.press("Enter");
    await expect(editor.locator(".mention")).toContainText("@sam");
  });
});
