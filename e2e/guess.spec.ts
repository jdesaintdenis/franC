import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory, deleteCategoriesWithPrefix } from "./helpers/manage";
import { clearQueue } from "./helpers/queue";
import { closeSheet, pickCategory, reviewCategory, setCategoryInSheet, sheetOf, toastWith } from "./helpers/sheet";
import { chooseCsv } from "./helpers/imports";

const PREFIX = "E2E Guess";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

async function createCategory(page: Page, name: string) {
  await addCategory(page, name);
}

/** Rows of one merchant label, one per day from `firstDay`; returns the import result text locator. */
async function importMerchant(page: Page, fileName: string, label: string, firstDay: number, count: number) {
  const rows = Array.from({ length: count }, (_, i) => {
    const date = `${String(firstDay + i).padStart(2, "0")}/05/2025`;
    return `${date};${label};PRLV ${label};GS${firstDay + i};GS${firstDay + i}-;Prelevement;;;-${10 + firstDay + i},00;;${date};${date};0`;
  });
  await page.goto("/import");
  await chooseCsv(page, {
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: `Import ${count} transactions` }).click();
  await expect(page.getByText(`${count} imported`)).toBeVisible();
}

async function undoImport(page: Page, fileName: string) {
  await page.goto("/import");
  // Wait for the page before looking: a row missed here would be left behind for the next spec.
  await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
  const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: fileName });
  if ((await row.count()) === 0) return;
  await row.getByRole("button", { name: /^Options for / }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row).toHaveCount(0);
}

// Deleting a category also removes its rules and dismissals (cascade).
async function deleteCategories(page: Page) {
  await deleteCategoriesWithPrefix(page, PREFIX);
}

const files: string[] = [];

test.afterEach(async ({ page }) => {
  for (const file of files.splice(0)) await undoImport(page, file);
  await deleteCategories(page);
});

test("guess: guessed rows arrive on import, Accept, Guess categories, rule suggestion and Create rule", async ({ page, sql, workerUser }) => {
  const ts = Date.now();
  const category = `${PREFIX} ${ts}`;
  const label = `GSSHOP${ts}X`;
  const fileA = `guess-a-${ts}.csv`;
  const fileB = `guess-b-${ts}.csv`;
  files.push(fileA, fileB);
  await clearQueue(page, sql, workerUser);
  await createCategory(page, category);

  // Three rows of one merchant; two are categorized by hand on the review page.
  await importMerchant(page, fileA, label, 10, 3);
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "3 to review" })).toBeVisible();
  await pickCategory(page, reviewCategory(page), category);
  await expect(page.getByRole("heading", { name: "2 to review" })).toBeVisible();
  await pickCategory(page, reviewCategory(page), category);
  await expect(page.getByRole("heading", { name: "1 to review" })).toBeVisible();
  // Two hand categorizations are not enough for a suggestion yet.
  await expect(page.getByTestId("rule-suggestion")).toHaveCount(0);

  // Two more rows of the same merchant: the import guesses them from the earlier choices.
  await importMerchant(page, fileB, label, 20, 2);
  await expect(page.getByText("2 categories guessed from your past choices")).toBeVisible();

  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "3 to review" })).toBeVisible();
  const card = page.locator('[data-testid="review-card"]:visible');
  await expect(card.locator('[data-slot="category-source"]')).toContainText("Guess");
  await expect(card.getByText("Guessed from your past choices")).toBeVisible();
  await expect(reviewCategory(page)).toHaveAccessibleName(`Category: ${category}`);

  // Accept keeps the category as a hand categorization, marks the row reviewed and moves on.
  await card.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2 to review" })).toBeVisible();
  await expect(toastWith(page, "Marked 1 as reviewed")).toBeVisible();

  // Three hand categorizations of one merchant: the review page offers a rule.
  const suggestion = page.getByTestId("rule-suggestion");
  await expect(suggestion).toContainText(`You put 3 ${label} transactions in ${category}. Always do this?`);

  // "Guess categories" guesses the third, still uncategorized row and puts it back in the queue.
  await page.getByRole("button", { name: "Guess categories" }).click();
  await expect(toastWith(page, /^Categorized \d+: \d+ by rules, \d+ from bank categories, \d+ guessed$/)).toBeVisible();
  await expect(page.locator('[data-testid="review-card"]:visible').locator('[data-slot="category-source"]')).toContainText("Guess");

  // Create rule: the two remaining guesses become rule categories.
  await suggestion.getByRole("button", { name: "Create rule" }).click();
  await expect(toastWith(page, "Rule created · 2 transactions categorized")).toBeVisible();
  await expect(suggestion).toHaveCount(0);
  await expect(page.locator('[data-testid="review-card"]:visible').locator('[data-slot="category-source"]')).toContainText("From your rule");

  // The rule shows in Settings > Rules and nothing is left to suggest.
  await page.goto("/settings/rules");
  await expect(page.getByRole("list", { name: "Rules in evaluation order" })).toContainText(label);
  await expect(page.getByRole("heading", { name: "Suggested rules" })).toHaveCount(0);
});

test("guess: marks on Transactions, Validate a guess in the sheet, Not now, and Settings > Rules suggestions", async ({ page, sql, workerUser }) => {
  const ts = Date.now();
  const category = `${PREFIX} ${ts}`;
  const label = `GSTXN${ts}X`;
  const fileA = `guess-txn-a-${ts}.csv`;
  const fileB = `guess-txn-b-${ts}.csv`;
  files.push(fileA, fileB);
  await clearQueue(page, sql, workerUser);
  await createCategory(page, category);

  await importMerchant(page, fileA, label, 10, 2);
  await page.goto(`/transactions?q=${label}`);
  for (let i = 0; i < 2; i++) {
    await setCategoryInSheet(page, page.getByRole("button", { name: /Categorize/ }).nth(i), category);
  }
  await expect(page.getByTestId("rule-suggestion")).toHaveCount(0);

  await importMerchant(page, fileB, label, 20, 2);
  await page.goto(`/transactions?q=${label}`);
  const guessedRows = page.getByRole("button", { name: /Categorize/ }).filter({ hasText: "Guessed category:" });
  await expect(guessedRows).toHaveCount(2);

  // The sheet says where the category came from and offers Validate.
  await guessedRows.first().click();
  const sheet = sheetOf(page);
  await expect(sheet.getByText("Guessed from your past choices")).toBeVisible();
  await expect(sheet.getByTestId("sheet-category")).toHaveAccessibleName(`Category: ${category}`);
  await sheet.getByRole("button", { name: `Validate in ${category}` }).click();
  await expect(toastWith(page, `Kept ${category}`)).toBeVisible();

  // The third hand categorization makes the server's suggestion appear in the sheet.
  const suggestion = sheet.getByTestId("rule-suggestion");
  await expect(suggestion).toContainText(`You put 3 ${label} transactions in ${category}. Always do this?`);
  // The page behind a modal sheet is out of the accessibility tree: close it before counting rows.
  await closeSheet(page);
  await expect(guessedRows).toHaveCount(1);

  // It is also listed in Settings > Rules, until dismissed.
  await page.goto("/settings/rules");
  const section = page.getByRole("region", { name: "Suggested rules" });
  await expect(section).toContainText("Would categorize 1 transaction now");
  await section.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("heading", { name: "Suggested rules" })).toHaveCount(0);

  // A dismissed suggestion does not come back on the list.
  await page.goto(`/transactions?q=${label}`);
  await page.getByRole("button", { name: /Categorize/ }).filter({ hasText: "Guessed category:" }).click();
  await sheet.getByRole("button", { name: `Validate in ${category}` }).click();
  await expect(toastWith(page, `Kept ${category}`)).toBeVisible();
  await expect(page.getByTestId("rule-suggestion")).toHaveCount(0);
  await closeSheet(page);
});
