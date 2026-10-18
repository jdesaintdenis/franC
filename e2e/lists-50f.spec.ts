import { devices, type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addAccount, deleteAccountsWithPrefix, deleteCategory, manageSheet, rowMenuAction, setBudget, setStartingBalance } from "./helpers/manage";
import { toastWith } from "./helpers/sheet";
import { parisToday } from "./helpers/dates";
import { billRow, csvFile, debitRow, importFile, recentDate, settled, showToConfirmList, toConfirmRow, undoImport } from "./helpers/recurring";

// Phone viewport, like the other phone specs.
test.use({ ...devices["Pixel 7"] });

const PREFIX = "E2E Lists50";

/** Elements with visible text in a red colour (amber is the warning colour in this look). */
function redTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const m = getComputedStyle(el).color.match(/\d+/g)?.map(Number);
        return m && el.getClientRects().length > 0 && el.textContent?.trim() && m[0] > 200 && m[1] < 130 && m[2] < 130;
      })
      .map((el) => `${el.tagName}.${el.className} "${el.textContent?.slice(0, 30)}"`),
  );
}

test("the four lists wear the 50 F look and never scroll sideways", async ({ page }) => {
  for (const path of ["/settings/categories", "/settings/budgets", "/settings/goals", "/recurring"]) {
    await page.goto(path);
    await expect(page.locator("div.theme-50f.bg-50f").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, path).toBe(false);
    // No red anywhere on the page (amber is the warning colour in this look).
    const red = await redTexts(page);
    expect(red, path).toEqual([]);
  }
});

test("a detected payment is confirmed from the À confirmer list, Undo puts it back, the view is remembered", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E-L50-${stamp}`;
  const file = csvFile(`l50-${stamp}.csv`, [
    debitRow(recentDate(2, 6), name, "-7,00"),
    debitRow(recentDate(1, 6), name, "-7,00"),
    debitRow(recentDate(0, 6), name, "-7,00"),
  ]);
  await importFile(page, file, 3);
  try {
    await page.goto("/recurring");
    await expect(page.getByTestId("to-confirm").getByText(/^\d+ of \d+/)).toBeVisible();
    await showToConfirmList(page);
    await expect(toConfirmRow(page, name)).toHaveCount(1);

    await settled(page, () => toConfirmRow(page, name).getByRole("button", { name: `Confirm ${name}` }).click());
    await expect(billRow(page, name)).toHaveCount(1);
    await expect(toConfirmRow(page, name)).toHaveCount(0);
    await settled(page, () => toastWith(page, `${name} confirmed`).getByRole("button", { name: /^Undo/ }).click());
    await showToConfirmList(page);
    await expect(toConfirmRow(page, name)).toHaveCount(1);

    // The list view stays after a reload.
    await page.reload();
    await expect(page.getByRole("list", { name: "Payments to confirm", exact: true })).toBeVisible();
  } finally {
    await undoImport(page, file.name);
  }
});

test("category form: swatch, exact hex, parent pills", async ({ page }) => {
  const name = `${PREFIX} Cat ${Date.now()}`;
  try {
    await page.goto("/settings/categories?add=1");
    const sheet = manageSheet(page);
    await sheet.getByLabel("Name", { exact: true }).fill(name);
    await sheet.getByRole("radio", { name: /^Colour 3/ }).check({ force: true });
    const hex = sheet.getByLabel("Or an exact colour");
    await expect(hex).toHaveValue("#d97706");
    await hex.fill("#4f7cff");
    await expect(sheet.getByRole("radio", { checked: true, name: /^Colour/ })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Add category" }).click();
    await expect(sheet).toBeHidden();

    await rowMenuAction(page, name, "Rename, icon, colour");
    await expect(manageSheet(page).getByLabel("Or an exact colour")).toHaveValue("#4f7cff");
    await page.keyboard.press("Escape");
    // Closing drops the sheet's history entry; a page load started before that would be cancelled by it.
    await expect(manageSheet(page)).toBeHidden();
  } finally {
    await deleteCategory(page, name);
  }
});

test("a goal on an account: ＋ assigns, the quick amount fills the field", async ({ page }) => {
  const stamp = Date.now();
  const account = `${PREFIX} Account ${stamp}`;
  const goal = `${PREFIX} Goal ${stamp}`;
  try {
    await addAccount(page, account);
    await setStartingBalance(page, account, "500,00");
    await page.goto("/settings/goals?add=1");
    const sheet = manageSheet(page);
    await sheet.getByLabel("Name", { exact: true }).fill(goal);
    await sheet.getByLabel("Target", { exact: true }).fill("1000");
    await sheet.getByRole("radio", { name: "On an account" }).click();
    await sheet.getByRole("radio", { name: account, exact: true }).click();
    await sheet.getByRole("button", { name: "Add goal" }).click();
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: `Assign money to ${goal}` }).click();
    await manageSheet(page).getByRole("button", { name: /^All · €500\.00$/ }).click();
    await expect(manageSheet(page).getByLabel("Amount", { exact: true })).toHaveValue("500");
  } finally {
    await page.goto("/settings/goals");
    await rowMenuAction(page, goal, "Delete").catch(() => {});
    await deleteAccountsWithPrefix(page, PREFIX);
  }
});

test("confirmed list folds to 4 rows, Show more unfolds it", async ({ page }) => {
  const stamp = Date.now();
  const names = Array.from({ length: 5 }, (_, i) => `E2E-L50F${i}-${stamp}`);
  const file = csvFile(
    `l50fold-${stamp}.csv`,
    names.flatMap((n) => [3, 2, 1, 0].map((m) => debitRow(recentDate(m, 7), n, "-9,00"))),
  );
  await importFile(page, file, 20);
  try {
    await page.goto("/recurring");
    await showToConfirmList(page);
    await settled(page, () => page.getByRole("button", { name: "Confirm all" }).click());
    await page.reload();
    const bills = page.getByRole("list", { name: "Bills and subscriptions", exact: true });
    const more = page.getByRole("button", { name: /^Show \d+ more$/ });
    await expect(more).toBeVisible();
    // Items that need a look stay on top and are never folded away, so the list is at least 4 rows.
    expect(await bills.getByRole("listitem").count()).toBeGreaterThanOrEqual(4);
    await more.first().click();
    for (const n of names) await expect(billRow(page, n)).toHaveCount(1);
    // The button stays (keeps keyboard focus) and folds the list back.
    await expect(page.getByRole("button", { name: "Show less" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Show less" }).first().click();
    await expect(more.first()).toBeVisible();
  } finally {
    await undoImport(page, file.name);
  }
});

test("over budget reads amber on the budget pages, never red", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const name = `${PREFIX} Over ${stamp}`;
  const merchant = `ZQOVER${stamp}`;
  const [category] = await sql`
    insert into categories (user_id, name, color) values (${workerUser.id}, ${name}, '#112233') returning id`;
  await sql`
    insert into category_rules (user_id, category_id, match_type, pattern)
    values (${workerUser.id}, ${category.id}, 'contains', ${merchant})`;
  const [year, month, day] = parisToday().split("-");
  const date = `${day}/${month}/${year}`;
  const file = csvFile(`l50over-${stamp}.csv`, [debitRow(date, merchant, "-50,00")]);
  await importFile(page, file, 1);
  try {
    await setBudget(page, name, "10,00");
    for (const path of ["/settings/budgets", "/budget", "/"]) {
      await page.goto(path);
      // On /budget the spending ring above also lists the category: look inside Budgets only.
      const scope = path === "/budget" ? page.getByRole("region", { name: "Budgets" }) : page;
      const row = scope.getByRole("listitem").filter({ hasText: name }).or(scope.getByRole("link").filter({ hasText: name })).first();
      if (path === "/" && (await row.count()) === 0) continue; // Home lists only the first budgets
      await expect(row, path).toContainText("€40.00 over");
      // Home draws its own over-budget line; the amber classes are checked on the two budget pages.
      if (path !== "/") {
        await expect(row.locator(".text-warning", { hasText: /€40\.00 over/ }).first(), path).toBeVisible();
        await expect(row.locator(".text-warning", { hasText: /500\s?%/ }).first(), path).toBeVisible();
      }
      expect(await redTexts(page), path).toEqual([]);
    }
  } finally {
    await sql`delete from categories where user_id = ${workerUser.id} and name like ${PREFIX + "%"}`;
    await undoImport(page, file.name);
  }
});
