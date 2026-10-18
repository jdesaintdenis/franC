import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { clearStartingBalances, setStartingBalance } from "./helpers/manage";
import { csvFile, debitRow, importFile, recentDate, undoImport } from "./helpers/recurring";

test.use({ viewport: { width: 375, height: 800 } });

// The worker's E2E user must end up without a starting balance.
test.afterEach(async ({ page }) => {
  await clearStartingBalances(page);
});

async function firstAccountName(page: Page): Promise<string> {
  await page.goto("/accounts");
  const label = await page.getByRole("button", { name: /^Options for / }).first().getAttribute("aria-label");
  return (label ?? "").replace(/^Options for /, "");
}

test("coming up this month: the biggest bills, a strip with a tappable dot per day, no sideways scroll", async ({ page }) => {
  // An import, a balance, three page loads and the undo: close to the 30 s default under four busy workers.
  test.slow();
  const stamp = Date.now();
  const big = `ZQUPBIG${stamp}`;
  const small = `ZQUPSM${stamp}`;
  // Three months of the same two monthly debits: both are detected and project onto this month (20th and 21st).
  const file = csvFile(
    `ZQUP-${stamp}.csv`,
    [3, 2, 1].flatMap((ago) => [debitRow(recentDate(ago, 20), big, "-900,00"), debitRow(recentDate(ago, 21), small, "-12,00")]),
  );
  await importFile(page, file, 6);

  try {
    await setStartingBalance(page, await firstAccountName(page), "5 000,00");
    await page.goto("/");

    const card = page.getByTestId("home-upcoming");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("upcoming-total")).toContainText("€");

    // Under Budgets when there are budgets, before Goals: the card never sits above them.
    const budgets = page.locator("#budgets-heading");
    if ((await budgets.count()) > 0) {
      const [b, c] = [await budgets.boundingBox(), await card.boundingBox()];
      expect(c!.y).toBeGreaterThan(b!.y);
    }

    // The three biggest bills still due, largest first; the 900 € bill leads.
    const list = card.getByRole("list", { name: "Biggest bills still due" });
    await expect(list.getByRole("listitem").first()).toContainText(big);
    await expect(list.getByRole("listitem").first()).toContainText("900");

    // A tap on a dot names its bill and the bill the day after: neighbouring dots overlap on a phone
    // (the bigger one sits on top), so the bubble covers both.
    const bubble = card.getByRole("status");
    await card.getByRole("button", { name: new RegExp(big) }).click();
    await expect(bubble).toContainText(big);
    await expect(bubble).toContainText(small);
    await page.keyboard.press("Escape");
    await expect(bubble).toBeEmpty();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // A row opens the regular payment.
    await list.getByRole("listitem").first().getByRole("link").click();
    await expect(page).toHaveURL(/\/recurring\?item=/);
  } finally {
    await undoImport(page, file.name);
  }
});
