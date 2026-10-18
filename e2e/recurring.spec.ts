import { expect, test } from "./fixtures";
import { toastWith } from "./helpers/sheet";
import {
  billRow,
  csvFile,
  debitRow,
  importFile,
  itemSheet,
  recentDate,
  settled,
  sheetAction,
  showToConfirmList,
  swipe,
  toConfirmRow,
  undoImport,
} from "./helpers/recurring";

test("regular payments: headline, sheet, confirm all, dismiss, undo and restore", async ({ page }) => {
  const stamp = Date.now();
  const monthly = `E2E-REC-${stamp}`;
  const irregular = `E2E-IRR-${stamp}`;
  // Detection drops items whose last charge is older than two intervals before the user's
  // latest transaction, so the series uses the last three months.
  const file = csvFile(`rec-${stamp}.csv`, [
    debitRow(recentDate(2, 1), monthly, "-9,99"),
    debitRow(recentDate(1, 1), monthly, "-9,99"),
    debitRow(recentDate(0, 1), monthly, "-9,99"),
    // Gaps of 3, 40 and 5 days with varying amounts: no regular pattern.
    debitRow(recentDate(2, 3), irregular, "-4,00"),
    debitRow(recentDate(1, 12), irregular, "-25,30"),
    debitRow(recentDate(0, 2), irregular, "-61,10"),
  ]);
  await importFile(page, file, 6);

  try {
    await page.goto("/recurring");
    await expect(page.getByRole("heading", { level: 1, name: "Regular payments" })).toBeVisible();
    const headline = page.getByRole("region", { name: "Monthly cost of bills and subscriptions" });
    await showToConfirmList(page);
    await expect(page.getByText(irregular)).toHaveCount(0);

    // Detected: it waits in the "To confirm" block, not in the confirmed list.
    const row = toConfirmRow(page, monthly);
    await expect(row).toHaveCount(1);
    await expect(billRow(page, monthly)).toHaveCount(0);
    await expect(row).toContainText("Every month");
    await expect(row).toContainText("-€9.99");

    // The sheet: history and the link to the transactions.
    await row.getByRole("button").first().click();
    const sheet = itemSheet(page, monthly);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("list", { name: "Last charges" }).getByRole("listitem")).toHaveCount(3);
    await expect(sheet.getByRole("link", { name: "See all transactions" })).toHaveAttribute("href", /q=E2E-REC-/);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Confirm all, then Undo puts everything back to "To confirm".
    await settled(page, () => page.getByRole("button", { name: "Confirm all" }).click());
    await expect(row).toHaveCount(0);
    await expect(billRow(page, monthly)).toHaveCount(1);
    await expect(headline).toContainText(/a month confirmed/);
    await expect(page.getByRole("button", { name: "Confirm all" })).toHaveCount(0);
    await settled(page, () => toastWith(page, /confirmed/).getByRole("button", { name: /^Undo/ }).click());
    await showToConfirmList(page);
    await expect(row).toHaveCount(1);
    await page.reload();
    await showToConfirmList(page);
    await expect(toConfirmRow(page, monthly)).toHaveCount(1);

    // Confirm from the sheet.
    await toConfirmRow(page, monthly).getByRole("button").first().click();
    await sheetAction(page, monthly, "Confirm").click();
    await expect(itemSheet(page, monthly)).toBeHidden();
    await expect(billRow(page, monthly)).toHaveCount(1);

    // Dismiss from the sheet, then Undo: it is back, still confirmed.
    await billRow(page, monthly).getByRole("button").click();
    await sheetAction(page, monthly, "Dismiss").click();
    await expect(billRow(page, monthly)).toHaveCount(0);
    await settled(page, () => toastWith(page, `${monthly} dismissed`).getByRole("button", { name: /^Undo/ }).click());
    await expect(billRow(page, monthly)).toHaveCount(1);

    // Swipe left dismisses; it lands under Dismissed and stays out after Detect now.
    await settled(page, () => swipe(billRow(page, monthly).getByRole("button"), -260));
    await expect(billRow(page, monthly)).toHaveCount(0);
    await expect(toastWith(page, `${monthly} dismissed`)).toBeVisible();
    await page.goto("/budget/next-month");
    await expect(page.getByRole("list", { name: "Expected payments" }).getByText(monthly)).toHaveCount(0);
    await page.goto("/recurring");
    await page.getByRole("button", { name: "Detect now" }).click();
    await expect(toastWith(page, /recurring payment/)).toBeVisible();
    await expect(billRow(page, monthly)).toHaveCount(0);

    await page.getByText(/^Dismissed \(\d+\)$/).click();
    const dismissed = page.getByRole("list", { name: "Dismissed regular payments" }).getByRole("listitem").filter({ hasText: monthly });
    await expect(dismissed).toHaveCount(1);
    await settled(page, () => dismissed.getByRole("button", { name: /Restore/ }).click());
    await expect(billRow(page, monthly)).toHaveCount(1);
    await page.reload();
    await expect(billRow(page, monthly)).toHaveCount(1);
    // Restoring links its transactions again.
    await billRow(page, monthly).getByRole("button").click();
    await expect(itemSheet(page, monthly).getByRole("list", { name: "Last charges" }).getByRole("listitem")).toHaveCount(3);
  } finally {
    await undoImport(page, file.name);
  }
});

test("regular payments: swipe right confirms a detected item, Undo puts it back", async ({ page }) => {
  const stamp = Date.now();
  const monthly = `E2E-SWC-${stamp}`;
  const file = csvFile(`swc-${stamp}.csv`, [
    debitRow(recentDate(2, 4), monthly, "-5,00"),
    debitRow(recentDate(1, 4), monthly, "-5,00"),
    debitRow(recentDate(0, 4), monthly, "-5,00"),
  ]);
  await importFile(page, file, 3);

  try {
    await page.goto("/recurring");
    await showToConfirmList(page);
    const row = toConfirmRow(page, monthly);
    await expect(row).toHaveCount(1);
    await swipe(row.getByRole("button").first(), 260);
    await expect(row).toHaveCount(0);
    await expect(billRow(page, monthly)).toHaveCount(1);
    await toastWith(page, `${monthly} confirmed`).getByRole("button", { name: /^Undo/ }).click();
    await showToConfirmList(page);
    await expect(toConfirmRow(page, monthly)).toHaveCount(1);

    // A malformed ?item= is ignored (price-alerts.spec covers a real one).
    await page.goto("/recurring?item=not-a-uuid");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await undoImport(page, file.name);
  }
});
