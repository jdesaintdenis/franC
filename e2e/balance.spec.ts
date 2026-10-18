import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { clearStartingBalances, manageSheet, openStartingBalance, setStartingBalance } from "./helpers/manage";

const list = (page: Page) => page.getByRole("list", { name: "Your accounts" });

// The worker's E2E user is shared by the specs it runs and must end up without a starting balance.
test.afterEach(async ({ page }) => {
  await clearStartingBalances(page);
});

test("balance: set a starting balance, see it on the dashboard, remove it", async ({ page }) => {
  await page.goto("/accounts");
  const name = ((await page.getByRole("button", { name: /^Options for / }).first().getAttribute("aria-label")) ?? "").replace(/^Options for /, "");
  const row = list(page).getByRole("listitem").first();
  await expect(row.getByText(/^€/)).toBeHidden();

  let sheet = await openStartingBalance(page, name);
  await expect(sheet.getByText("No starting balance")).toBeVisible();
  // Errors are inline and keep the sheet open.
  await sheet.getByLabel("Balance", { exact: true }).fill("abc");
  await sheet.getByRole("button", { name: "Save balance" }).click();
  await expect(sheet.getByRole("alert").filter({ hasText: "valid amount" })).toContainText("valid amount");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await setStartingBalance(page, name, "1 234,56", { threshold: "100" });
  // The row shows the balance on the right; the sheet says what it starts from.
  await expect(row.getByText(/€\d/)).toBeVisible();
  sheet = await openStartingBalance(page, name);
  await expect(sheet.getByText(/Starting balance .*1,234\.56.* on \d{1,2} [A-Z][a-z]{2,4}( \d{4})?/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Dashboard card, no horizontal overflow on a phone.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/budget");
  const card = page.getByRole("region", { name: "Balance", exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByText(/1,234\.56/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const results = await new AxeBuilder({ page })
      .include('[aria-labelledby="balance-heading"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations, `axe violations in ${colorScheme} theme`).toEqual([]);
  }

  await page.goto("/accounts");
  sheet = await openStartingBalance(page, name);
  await sheet.getByRole("button", { name: "Remove starting balance" }).click();
  await expect(sheet).toBeHidden();
  sheet = await openStartingBalance(page, name);
  await expect(sheet.getByText("No starting balance")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(manageSheet(page)).toBeHidden();
  await page.goto("/budget");
  await expect(page.getByRole("region", { name: "Balance", exact: true })).toBeHidden();
});
