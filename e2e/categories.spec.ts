import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory, addRule, addSubcategory, deleteCategory, manageSheet, rowMenuAction } from "./helpers/manage";

test.use({ ...devices["Pixel 7"] });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function csvRow(label: string, i: number) {
  const date = `${String(1 + i).padStart(2, "0")}/01/2025`;
  const rowLabel = `${label} R${String(i).padStart(3, "0")}`;
  const amount = 10 + i;
  return `${date};${rowLabel};PRLV ${rowLabel};REF${i};REF${i}-;Prelevement;;;-${amount},00;;${date};${date};0`;
}

test("categories and rules: create, rename, rule, import categorizes, delete uncategorizes", async ({ page }) => {
  const ts = Date.now();
  const name = `E2E Cat ${ts}`;
  const renamed = `E2E Renamed ${ts}`;
  const merchant = `ZQMERCH${ts}`;

  // Create the category through the header sheet, then rename it from its menu.
  await addCategory(page, name);
  await rowMenuAction(page, name, "Rename, icon, colour");
  const sheet = manageSheet(page);
  await sheet.getByLabel("Name", { exact: true }).fill(renamed);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  const list = page.getByRole("list", { name: "Categories" });
  await expect(list.getByText(renamed)).toBeVisible();

  // Rule: contains <merchant> -> the category.
  await addRule(page, { category: renamed, pattern: merchant });

  // Import two rows of that merchant; the rule categorizes them on insert.
  const lines = [HEADER, csvRow(merchant, 0), csvRow(merchant, 1)];
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: `cat-${ts}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByText("2 imported")).toBeVisible();

  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  await expect(page.getByText("2 transactions", { exact: true })).toBeVisible();
  // Scoped to the list: the filter's category select also contains the name.
  const txList = page.getByRole("list", { name: "Transactions" });
  await expect(txList.getByText(renamed)).toHaveCount(2);

  // Deleting the category leaves its transactions uncategorized; it is in use, so the choices sheet opens.
  await page.goto("/settings/categories");
  await rowMenuAction(page, renamed, "Delete");
  const dialog = manageSheet(page);
  await expect(dialog.getByText(/2 transactions uncategorized/)).toBeVisible();
  await expect(dialog.getByText(/1 rule\b/)).toBeVisible();
  await expect(dialog.getByText("This can't be undone.")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete category" }).click();
  // The sheet closes only once the delete action has succeeded.
  await expect(dialog).toBeHidden();
  await expect(list.getByText(renamed)).toHaveCount(0);

  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  await expect(txList.getByText("Uncategorized")).toHaveCount(2);
});

test("categories: header sheet adds, menu renames and adds a subcategory, unused delete offers Undo", async ({ page }) => {
  const ts = Date.now();
  const name = `E2E Unused ${ts}`;
  const renamed = `E2E Unused Renamed ${ts}`;
  const child = `E2E Unused Child ${ts}`;

  // "＋ Add" in the header opens the create sheet and closes it with a toast.
  await page.goto("/settings/categories");
  await page.getByRole("link", { name: /^(Add a category|New category)$/ }).click();
  const sheet = manageSheet(page);
  await expect(sheet.getByRole("heading", { name: "Add a category" })).toBeVisible();
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByRole("button", { name: "Add category" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Category added")).toBeVisible();
  const row = page.getByTestId("category-row").filter({ hasText: name });
  // A category that spent nothing shows no figure.
  await expect(row).not.toContainText("€");

  // Tapping the row opens the edit sheet (deep link ?edit=<id>); the menu's first item does the same.
  await rowMenuAction(page, name, "Rename, icon, colour");
  await expect(page).toHaveURL(/[?&]edit=/);
  await sheet.getByLabel("Name", { exact: true }).fill(renamed);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("category-row").filter({ hasText: renamed })).toBeVisible();

  // Add a subcategory: the parent is preset and the caption counts it.
  await addSubcategory(page, renamed, child);
  await expect(page.getByRole("list", { name: `Subcategories of ${renamed}` }).getByText(child)).toBeVisible();

  // Delete the subcategory (unused): immediate, with Undo that brings it back under its parent.
  await rowMenuAction(page, child, "Delete");
  await expect(page.getByText(`${child} deleted`)).toBeVisible();
  await expect(page.getByRole("button", { name: `Options for ${child}`, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `Undo: ${child} deleted` }).click();
  await expect(page.getByRole("list", { name: `Subcategories of ${renamed}` }).getByText(child)).toBeVisible();

  // Clean up (both are unused again, so each goes at once).
  await deleteCategory(page, child);
  await deleteCategory(page, renamed);
});

test("categories: a long name wraps without widening a 390px page", async ({ page }) => {
  // 50 characters is the limit; one unbroken word is what could widen the page.
  const name = `E2E${"W".repeat(47)}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await addCategory(page, name);
  await expect(page.getByTestId("category-row").filter({ hasText: name })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await deleteCategory(page, name);
});
