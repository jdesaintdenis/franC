import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";
import { toastWith } from "./helpers/sheet";
import { addCategory, addSubcategory, deleteCategory, manageSheet, rowMenuAction } from "./helpers/manage";

// Same setup as categorize.spec.ts: phone viewport.
test.use({ ...devices["Pixel 7"] });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

// A month no other spec uses, so the dashboard assertions only see these rows.
const MONTH = "2019-06";

function csvRow(merchant: string, i: number) {
  const date = `${String(1 + i).padStart(2, "0")}/06/2019`;
  const rowLabel = `${merchant} R${i}`;
  return `${date};${rowLabel};CB ${rowLabel};REF${i};REF${i}-;Carte;;;-${10 + i},00;;${date};${date};0`;
}

test("subcategories: file under a subcategory with bulk edit, roll up on the dashboard, delete the parent", async ({ page }) => {
  const ts = Date.now();
  const parent = `E2E Home ${ts}`;
  const child = `E2E Furniture ${ts}`;
  const path = `${parent} > ${child}`;
  const merchant = `SUBCATSHOP${ts}`;

  // Create the parent, then a subcategory under it.
  await addCategory(page, parent);
  await addSubcategory(page, parent, child);
  const list = page.getByRole("list", { name: "Categories" });
  const subList = page.getByRole("list", { name: `Subcategories of ${parent}` });
  await expect(subList.getByText(child)).toBeVisible();

  // Import three rows.
  const lines = [HEADER, ...[0, 1, 2].map((i) => csvRow(merchant, i))];
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: `subcat-${ts}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(page.getByText("3 imported")).toBeVisible();

  // Bulk edit: file all three under the subcategory.
  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  const txList = page.getByRole("list", { name: "Transactions" });
  await expect(txList.getByRole("button", { name: /^(Categorize|Select): / })).toHaveCount(3);
  await page.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("dialog", { name: "Options" }).getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "Select all loaded" }).click();
  await expect(page.getByText("3 selected")).toBeVisible();
  await page.getByLabel("Category for selected transactions").selectOption({ label: path });
  await page.getByRole("region", { name: "Bulk edit" }).getByRole("button", { name: "Apply" }).click();
  await expect(toastWith(page, "3 transactions updated")).toBeVisible();
  await expect(txList.getByText(child, { exact: true })).toHaveCount(3);

  // Bulk clear one of them.
  await page.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("dialog", { name: "Options" }).getByRole("button", { name: "Select" }).click();
  await txList.getByRole("checkbox").first().click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.getByRole("button", { name: "Clear category" }).click();
  await expect(toastWith(page, "1 transaction updated")).toBeVisible();
  await expect(txList.getByText(child, { exact: true })).toHaveCount(2);
  await expect(txList.getByText("Uncategorized")).toHaveCount(1);

  // Dashboard: the subcategory's spending counts in the parent, which drills down.
  await page.goto(`/budget?month=${MONTH}`);
  const parentLink = page.getByRole("link").filter({ hasText: parent });
  await expect(parentLink).toBeVisible();
  await parentLink.click();
  await expect(page).toHaveURL(/category=/);
  await expect(page.getByRole("link").filter({ hasText: child })).toBeVisible();
  await expect(page.getByRole("link", { name: "See all transactions" })).toBeVisible();

  // Filter on the parent includes its subcategory's rows.
  await page.getByRole("link", { name: "See all transactions" }).click();
  await expect(page).toHaveURL(/\/transactions\?/);
  await expect(page.getByRole("list", { name: "Transactions" }).getByText(child, { exact: true })).toHaveCount(2);

  // Delete the parent, keeping its subcategory as a top-level category.
  await page.goto("/settings/categories");
  await rowMenuAction(page, parent, "Delete");
  const dialog = manageSheet(page);
  await expect(dialog.getByLabel(/Keep the 1 subcategory as top-level categories/)).toBeChecked();
  await dialog.getByRole("button", { name: "Delete category" }).click();
  await expect(dialog).toBeHidden();
  await expect(list.getByText(parent)).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Options for ${child}`, exact: true })).toBeVisible();

  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  await expect(txList.getByText(child, { exact: true })).toHaveCount(2);

  // Clean up: delete the promoted category (it still has transactions, so the choices sheet opens).
  await deleteCategory(page, child);
});
