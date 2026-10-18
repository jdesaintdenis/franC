import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// The E2E user's language is saved in the database, so every test that changes
// it puts it back to "Automatic" and the other specs keep following the
// (English) browser.
async function resetToAutomatic(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: /^(Language|Langue)/ }).click();
  const automatic = page.getByRole("radio", { name: /^(Automatic|Automatique)/ });
  if (!(await automatic.isChecked())) {
    await automatic.check();
    await expect(page.locator('main fieldset[aria-busy="true"]')).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
}

test.describe("French browser", () => {
  test.use({ locale: "fr-FR" });

  test("gets the French UI, and choosing English in Settings sticks", async ({ page }) => {
    try {
      await page.goto("/settings");
      await expect(page.locator("html")).toHaveAttribute("lang", "fr");
      await expect(page.getByRole("heading", { level: 1, name: "Plus" })).toBeVisible();
      await page.getByRole("button", { name: /^Langue/ }).click();
      await expect(page.getByRole("radio", { name: "Automatique (langue du navigateur)" })).toBeChecked();

      await page.getByRole("radio", { name: "English" }).check();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      // The sheet stays open while the page behind switches language.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("heading", { level: 1, name: "More" })).toBeVisible();

      // Still English after a reload and on another page, although the browser asks for French.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "More" })).toBeVisible();
      await page.getByRole("button", { name: /^Language/ }).click();
      await expect(page.getByRole("radio", { name: "English" })).toBeChecked();
      await page.goto("/transactions");
      await expect(page.getByRole("heading", { level: 1, name: "Transactions" })).toBeVisible();
    } finally {
      await resetToAutomatic(page);
    }

    await expect(page.getByRole("heading", { level: 1, name: "Plus" })).toBeVisible();
  });

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("the login page is in French", async ({ page }) => {
      await page.goto("/login");
      await expect(page.locator("html")).toHaveAttribute("lang", "fr");
      await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
      await expect(page.getByLabel("Mot de passe")).toBeVisible();
    });
  });
});
