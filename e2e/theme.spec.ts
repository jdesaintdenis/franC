import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// Slice 61: there is one theme, the dark 50 F night, whatever the browser prefers.

/** "light" or "dark" from the body's painted background (computed colours come back in lab/oklch). */
async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3 < 128 ? "dark" : "light";
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} browser`, () => {
    test.use({ colorScheme });

    test("gets the dark UI, and Plus has no theme choice", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      expect(await bodyBackground(page)).toBe("dark");
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#04051a");

      await page.goto("/settings");
      await expect(page.getByRole("radio", { name: /^(System|Light|Dark)/ })).toHaveCount(0);
      expect(await bodyBackground(page)).toBe("dark");
    });

    test("login page is dark too", async ({ browser, baseURL }) => {
      const anonymous = await browser.newContext({
        colorScheme,
        storageState: { cookies: [], origins: [] },
      });
      try {
        const page = await anonymous.newPage();
        await page.goto(`${baseURL}/login`);
        await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
        expect(await bodyBackground(page)).toBe("dark");
      } finally {
        await anonymous.close();
      }
    });
  });
}
