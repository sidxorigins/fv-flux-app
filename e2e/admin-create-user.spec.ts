import { expect, test } from "@playwright/test";

test.describe("admin: create user with project access", () => {
  test("grants a project at creation and the user appears as a project member", async ({
    page,
  }) => {
    await page.goto("/admin/users");
    await page.getByRole("button", { name: "Create user" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const stamp = Date.now();
    const username = `qa${stamp}`;
    await dialog.locator("#cu-name").fill("QA Grant");
    await dialog.locator("#cu-email").fill(`${username}@iccadubai.ae`);
    await dialog.locator("#cu-username").fill(username);

    // The project-access picker is present; grant FLUX.
    await expect(dialog.getByText("Project access")).toBeVisible();
    await dialog.getByRole("checkbox", { name: /Grant access to Flux/ }).click();

    await dialog.getByRole("button", { name: "Create user" }).click();
    // Success screen inside the dialog (an invite/set-password link).
    await expect(dialog.getByText("User created")).toBeVisible();

    // The new user now shows on the project's members admin screen.
    await page.goto("/admin/projects");
    await page.getByRole("link", { name: /Flux/ }).first().click();
    await expect(page.getByText(username).first()).toBeVisible();
  });
});
