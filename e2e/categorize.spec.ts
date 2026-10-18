import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory, addRule, deleteCategory, deleteRule, manageSheet, openRowMenu, rowMenuAction } from "./helpers/manage";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";

// Same setup as transactions.spec.ts: phone viewport.
test.use({ ...devices["Pixel 7"] });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function csvRow(merchant: string, i: number) {
  const date = `${String(1 + i).padStart(2, "0")}/03/2025`;
  const rowLabel = `${merchant} R${i}`;
  const amount = 10 + i;
  return `${date};${rowLabel};PRLV ${rowLabel};REF${i};REF${i}-;Prelevement;;;-${amount},00;;${date};${date};0`;
}

test("categorize a transaction, create a rule, then override one manually", async ({ page }) => {
  // Letters only: the normalized label must not be split or altered by the pattern.
  const ts = Date.now();
  const merchant = `CATSHOP${ts}`;
  // New users start with no categories, so the test creates its own.
  const groceries = `E2E Groceries ${ts}`;
  const leisure = `E2E Leisure ${ts}`;
  for (const name of [groceries, leisure]) await addCategory(page, name);

  const lines = [HEADER, ...[0, 1, 2].map((i) => csvRow(merchant, i))];

  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: `cat-${Date.now()}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(page.getByText("3 imported")).toBeVisible();

  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  const list = page.getByRole("list", { name: "Transactions" });
  await expect(list.getByRole("button", { name: /^(Categorize|Select): / })).toHaveCount(3);

  // Tap the first row, pick the groceries category and turn the proposal into a rule.
  await list.getByRole("button", { name: /^(Categorize|Select): / }).first().click();
  const sheet = sheetOf(page);
  await sheet.getByTestId("sheet-category").click();
  await sheet.getByTestId("category-picker").getByRole("button", { name: groceries, exact: true }).click();
  const proposal = sheet.getByTestId("rule-suggestion");
  await expect(proposal).toBeVisible();
  await proposal.getByRole("button", { name: "Adjust" }).click();
  await expect(sheet.getByLabel("Pattern")).not.toHaveValue("");
  // Use just the merchant so the rule matches all three rows.
  await sheet.getByLabel("Pattern").fill(merchant);
  await sheet.getByRole("button", { name: "Create rule" }).click();
  const ruleToast = toastWith(page, "Rule created · 2 other transactions categorized");
  await expect(ruleToast).toBeVisible();
  // The toast covers the bottom of a phone screen and stays while the pointer is over it.
  await ruleToast.getByRole("button", { name: "Dismiss" }).click();
  await closeSheet(page);
  await expect(list.getByText(groceries, { exact: true })).toHaveCount(3);

  // Override by hand one of the rows the rule set (the first row was set manually above).
  await list.getByRole("button", { name: /^(Categorize|Select): / }).nth(1).click();
  await expect(sheet.getByText("Set by a rule")).toBeVisible();
  await sheet.getByTestId("sheet-category").click();
  // The pick shows at once and saves in the background: wait for that save before reloading.
  // Matched on its body: opening the sheet also posts other server actions (transfer info, suggestions).
  const saved = page.waitForResponse(
    (r) => r.request().headers()["next-action"] !== undefined && (r.request().postData() ?? "").includes('"categoryId"'),
  );
  await sheet.getByTestId("category-picker").getByRole("button", { name: leisure, exact: true }).click();
  await saved;
  await expect(sheet.getByText("Set manually")).toBeVisible();
  await closeSheet(page);

  await page.reload();
  await expect(list.getByText(leisure, { exact: true })).toHaveCount(1);
  await expect(list.getByText(groceries, { exact: true })).toHaveCount(2);

  // The leisure row is the one set manually.
  await list.getByRole("button", { name: /Categorize/ }).filter({ hasText: leisure }).click();
  await expect(sheet.getByText("Set manually")).toBeVisible();
});

test("rules: edit sheet, move down via the menu, delete and Undo restores the order", async ({ page }) => {
  const ts = Date.now();
  const category = `E2E Rules ${ts}`;
  const first = `RULEONE${ts}`;
  const second = `RULETWO${ts}`;
  await addCategory(page, category);
  await addRule(page, { category, pattern: first, apply: false });
  await addRule(page, { category, pattern: second, apply: false });

  const rules = page.getByRole("list", { name: "Rules in evaluation order" });
  const order = () => rules.locator("code").allTextContents();
  const mine = async () => (await order()).filter((p) => p.endsWith(String(ts)));
  expect(await mine()).toEqual([first, second]);

  // Move the first one down through its menu; the ends are disabled.
  await rowMenuAction(page, first, "Move down");
  await expect.poll(mine).toEqual([second, first]);
  // New rules go to the end, so after the move the first one is last: it can't move down.
  // (The worker's user may keep rules from other tests above these two.)
  const lastMenu = await openRowMenu(page, first);
  await expect(lastMenu.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  await page.keyboard.press("Escape");
  const menu = await openRowMenu(page, second);
  await expect(menu.getByRole("menuitem", { name: "Move down" })).toBeEnabled();
  await expect(menu.getByRole("menuitem", { name: "See matching transactions" })).toHaveAttribute(
    "href",
    `/transactions?q=${second}`,
  );
  await page.keyboard.press("Escape");

  // Tapping a row opens its edit sheet.
  await rules.getByRole("button", { name: `Edit rule ${second}` }).click();
  const sheet = manageSheet(page);
  await expect(sheet.getByLabel("Pattern")).toHaveValue(second);
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();

  // Delete is immediate; Undo puts the rule back at its place.
  await rowMenuAction(page, second, "Delete");
  await expect(page.getByText("Rule deleted")).toBeVisible();
  await expect.poll(mine).toEqual([first]);
  await page.getByRole("button", { name: "Undo: Rule deleted" }).click();
  await expect.poll(mine).toEqual([second, first]);

  await deleteRule(page, first);
  await deleteRule(page, second);
  await deleteCategory(page, category);
});
