import { expect, test } from "./fixtures";
import { sheetOf, toastWith } from "./helpers/sheet";
import { billRow, creditRow, csvFile, importFile, itemSheet, recentDate, settled, sheetAction, undoImport } from "./helpers/recurring";

test("track a varying salary as a regular payment", async ({ page }) => {
  const label = `E2E-SAL-${Date.now()}`;
  // Amounts vary by far more than the ±10% detection allows.
  const file = csvFile(`salary-${label}.csv`, [
    creditRow(recentDate(2, 1), label, "2400,00"),
    creditRow(recentDate(1, 1), label, "3300,00"),
    creditRow(recentDate(0, 1), label, "2850,00"),
  ]);
  await importFile(page, file, 3);

  try {
    await page.goto("/recurring");
    await expect(page.getByText(label)).toHaveCount(0);

    // Track from the transaction sheet.
    await page.goto(`/transactions?q=${label}`);
    await page.getByRole("button", { name: new RegExp(`^Categorize: ${label} `) }).first().click();
    await settled(page, () => sheetOf(page).getByTestId("sheet-track").click());
    await expect(toastWith(page, "Now a regular payment")).toBeVisible();
    await expect(sheetOf(page).getByTestId("sheet-recurring")).toBeVisible();

    // The expected amount is the median, shown as an estimate.
    await page.goto("/recurring");
    const row = billRow(page, label, "Income");
    await expect(row).toContainText("about +€2,850");
    await row.getByRole("button").click();
    const sheet = itemSheet(page, label);
    await expect(sheet).toContainText("Last 3 payments: +€2,400 to +€3,300");

    await page.goto("/budget/next-month");
    const forecastItem = page.getByRole("list", { name: "Expected income" }).getByRole("listitem").filter({ hasText: label });
    await expect(forecastItem).toContainText("about +€2,850");

    // Stop tracking: it is not detectable, so it leaves the list.
    await page.goto("/recurring");
    await billRow(page, label, "Income").getByRole("button").click();
    await settled(page, () => sheetAction(page, label, "Stop tracking").click());
    await page.reload();
    await expect(page.getByText(label)).toHaveCount(0);
  } finally {
    await undoImport(page, file.name);
  }
});
