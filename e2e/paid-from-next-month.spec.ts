import { expect, test } from "./fixtures";
import { clearStartingBalances, setStartingBalance } from "./helpers/manage";
import { creditRow, csvFile, importFile, debitRow, recentDate, undoImport } from "./helpers/recurring";

test("paid with next month's money: the switch shows on this month's expense and Home takes it out of what is kept", async ({
  page,
  sql,
  workerUser,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const salary = `E2E-PAYNEXT-${stamp}`;
  const fees = `E2E-FEES-${stamp}`;
  const fileName = `paid-next-${stamp}.csv`;
  // This month's salary and fees on the same day, before or on today. On the 1st-7th the salary sits in the leeway.
  const day = Math.min(new Date().getUTCDate(), 24);
  await importFile(
    page,
    csvFile(fileName, [
      creditRow(recentDate(3, 24), salary, "2412,00"),
      creditRow(recentDate(2, 24), salary, "2412,00"),
      creditRow(recentDate(1, 24), salary, "2412,00"),
      creditRow(recentDate(0, day), salary, "2412,00"),
      debitRow(recentDate(0, day), fees, "-1800,00"),
    ]),
    5,
  );

  try {
    // Confirm the salary and keep it for next month (e2e/keep-for-next-month.spec.ts covers that switch).
    await sql`update recurring set status = 'confirmed', keeps_for_next_month = true where user_id = ${workerUser.id} and typical_amount_cents > 0`;
    await page.goto("/accounts");
    const label = await page.getByRole("button", { name: /^Options for / }).first().getAttribute("aria-label");
    await setStartingBalance(page, (label ?? "").replace(/^Options for /, ""), "1 150,00");

    // An inflow has no switch.
    await page.goto(`/transactions?q=${encodeURIComponent(salary)}`);
    await page.getByRole("button", { name: new RegExp(salary, "i") }).first().click();
    await expect(page.getByRole("dialog").getByTestId("sheet-danger-zone")).toBeVisible();
    await expect(page.getByTestId("sheet-paid-next")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto(`/transactions?q=${encodeURIComponent(fees)}`);
    await page.getByRole("button", { name: new RegExp(fees, "i") }).first().click();
    const toggle = page.getByTestId("sheet-paid-next").getByRole("switch", { name: /^Paid with .+'s money/ });
    await expect(toggle).not.toBeChecked();
    const saved = page.waitForRequest((r) => r.method() === "POST" && (r.postData() ?? "").includes('"on":true'));
    await toggle.check();
    await saved;
    await expect(toggle).toBeChecked();
    await page.keyboard.press("Escape");

    await page.reload();
    await page.getByRole("button", { name: new RegExp(fees, "i") }).first().click();
    await expect(page.getByTestId("sheet-paid-next").getByRole("switch")).toBeChecked();
    await page.keyboard.press("Escape");

    // Home: the breakdown lists the fees under what is kept, and the result is 1 800 € higher than without them.
    await page.goto("/");
    await page.getByRole("button", { name: "How is this worked out?" }).click();
    const breakdown = page.getByRole("dialog", { name: "How it's worked out" });
    await expect(breakdown.getByText(new RegExp(`^Already spent: ${fees}`, "i"))).toBeVisible();
    const withFees = await breakdown.getByTestId("breakdown-result").textContent();
    await page.keyboard.press("Escape");

    // Switch it off: the line goes away and the result drops by the fees.
    await page.goto(`/transactions?q=${encodeURIComponent(fees)}`);
    await page.getByRole("button", { name: new RegExp(fees, "i") }).first().click();
    const off = page.waitForRequest((r) => r.method() === "POST" && (r.postData() ?? "").includes('"on":false'));
    await page.getByTestId("sheet-paid-next").getByRole("switch").uncheck();
    await off;
    await page.keyboard.press("Escape");
    await page.goto("/");
    await page.getByRole("button", { name: "How is this worked out?" }).click();
    const after = page.getByRole("dialog", { name: "How it's worked out" });
    await expect(after.getByText(/^Already spent: /)).toHaveCount(0);
    const cents = (s: string | null) => Math.round(Number((s ?? "").replace("−", "-").replace(/[^\d.,-]/g, "").replace(/,/g, "")) * 100);
    expect(cents(withFees) - cents(await after.getByTestId("breakdown-result").textContent())).toBe(180000);
  } finally {
    await page.goto("/accounts");
    await clearStartingBalances(page);
    await undoImport(page, fileName);
  }
});
