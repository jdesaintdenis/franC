import { expect, test } from "./fixtures";
import { clearStartingBalances, setStartingBalance } from "./helpers/manage";
import {
  billRow,
  creditRow,
  csvFile,
  debitRow,
  importFile,
  itemSheet,
  recentDate,
  settled,
  sheetAction,
  showToConfirmList,
  toConfirmRow,
  undoImport,
} from "./helpers/recurring";

test("keep for next month: the switch sticks, only shows on a confirmed income, and Home explains it", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const salary = `E2E-PAY-${stamp}`;
  const rent = `E2E-RENT-${stamp}`;
  const fileName = `keep-${stamp}.csv`;
  await importFile(
    page,
    csvFile(fileName, [
      creditRow(recentDate(3, 28), salary, "2412,00"),
      creditRow(recentDate(2, 28), salary, "2412,00"),
      creditRow(recentDate(1, 28), salary, "2412,00"),
      debitRow(recentDate(3, 2), rent, "-850,00"),
      debitRow(recentDate(2, 2), rent, "-850,00"),
      debitRow(recentDate(1, 2), rent, "-850,00"),
    ]),
    6,
  );

  try {
    await page.goto("/recurring");
    await showToConfirmList(page);
    // A payment still to confirm, and an outflow, have no switch.
    await toConfirmRow(page, rent).getByRole("button").first().click();
    await expect(itemSheet(page, rent)).toBeVisible();
    await expect(itemSheet(page, rent).getByRole("switch")).toHaveCount(0);
    await sheetAction(page, rent, "Confirm").click();
    await expect(itemSheet(page, rent)).toBeHidden();
    await billRow(page, rent).getByRole("button").click();
    await expect(itemSheet(page, rent)).toBeVisible();
    await expect(itemSheet(page, rent).getByRole("switch")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(itemSheet(page, rent)).toBeHidden();

    await toConfirmRow(page, salary).getByRole("button").first().click();
    await expect(itemSheet(page, salary).getByRole("switch")).toHaveCount(0);
    await sheetAction(page, salary, "Confirm").click();
    await expect(itemSheet(page, salary)).toBeHidden();

    await billRow(page, salary, "Income").getByRole("button").click();
    const sheet = itemSheet(page, salary);
    const toggle = sheet.getByRole("switch", { name: /Keep for next month/ });
    await expect(toggle).not.toBeChecked();
    await settled(page, () => toggle.check());
    await expect(toggle).toBeChecked();
    await expect(sheet.getByText(/kept for next month, except/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.reload();
    await billRow(page, salary, "Income").getByRole("button").click();
    await expect(itemSheet(page, salary).getByRole("switch", { name: /Keep for next month/ })).toBeChecked();
    await page.keyboard.press("Escape");

    // Home: a kept payment makes the "Kept for" line appear in the breakdown.
    await page.goto("/accounts");
    const label = await page.getByRole("button", { name: /^Options for / }).first().getAttribute("aria-label");
    await setStartingBalance(page, (label ?? "").replace(/^Options for /, ""), "1 234,56");
    await page.goto("/");
    await page.getByRole("button", { name: "How is this worked out?" }).click();
    const breakdown = page.getByRole("dialog", { name: "How it's worked out" });
    await expect(breakdown.getByText(/^Kept for /)).toBeVisible();
    await page.keyboard.press("Escape");

    // Switch it off: the line goes away.
    await page.goto("/recurring");
    await billRow(page, salary, "Income").getByRole("button").click();
    await settled(page, () => itemSheet(page, salary).getByRole("switch", { name: /Keep for next month/ }).uncheck());
    await page.keyboard.press("Escape");
    await page.goto("/");
    await page.getByRole("button", { name: "How is this worked out?" }).click();
    await expect(page.getByRole("dialog", { name: "How it's worked out" }).getByText(/^Kept for /)).toHaveCount(0);
  } finally {
    await page.goto("/accounts");
    await clearStartingBalances(page);
    await undoImport(page, fileName);
  }
});
