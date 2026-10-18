import { expect, test } from "./fixtures";
import { toastWith } from "./helpers/sheet";
import { billRow, csvFile, debitRow, importFile, itemSheet, recentDate, settled, sheetAction, showToConfirmList, toConfirmRow, undoImport } from "./helpers/recurring";

test("subscriptions: yearly cost, sort chip, mark ended and resume", async ({ page }) => {
  const stamp = Date.now();
  const monthly = `E2E-SUB-${stamp}`;
  const file = csvFile(`sub-${stamp}.csv`, [
    debitRow(recentDate(2, 1), monthly, "-9,99"),
    debitRow(recentDate(1, 1), monthly, "-9,99"),
    debitRow(recentDate(0, 1), monthly, "-9,99"),
  ]);
  const forecastItem = page.getByRole("list", { name: "Expected payments" }).getByRole("listitem").filter({ hasText: monthly });
  await importFile(page, file, 3);

  try {
    await page.goto("/recurring");
    await showToConfirmList(page);
    await toConfirmRow(page, monthly).getByRole("button").first().click();
    const sheet = itemSheet(page, monthly);
    await expect(sheet).toContainText("119.88 a year");
    await sheetAction(page, monthly, "Confirm").click();
    await expect(billRow(page, monthly)).toHaveCount(1);

    await page.getByRole("button", { name: "Sort", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cost per year" }).click();
    await expect(page).toHaveURL(/sort=yearly/);
    await expect(billRow(page, monthly)).toHaveCount(1);

    await billRow(page, monthly).getByRole("button").click();
    await settled(page, () => sheetAction(page, monthly, "Mark ended").click());
    await expect(billRow(page, monthly)).toHaveCount(0);
    await expect(toastWith(page, `${monthly} marked as ended`)).toBeVisible();
    await page.goto("/budget/next-month");
    await expect(forecastItem).toHaveCount(0);

    await page.goto("/recurring");
    await page.getByText(/^Ended \(\d+\)$/).click();
    const ended = page.getByRole("list", { name: "Ended regular payments" }).getByRole("listitem").filter({ hasText: monthly });
    await expect(ended).toContainText("You no longer pay");
    await settled(page, () => ended.getByRole("button", { name: /Resume/ }).click());
    await expect(billRow(page, monthly)).toHaveCount(1);
    await page.goto("/budget/next-month");
    await expect(forecastItem).toHaveCount(1);
  } finally {
    await undoImport(page, file.name);
  }
});
