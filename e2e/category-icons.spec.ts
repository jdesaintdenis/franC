import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";
import { toastWith } from "./helpers/sheet";
import { deleteCategory, manageSheet, pickCategoryIcon, rowMenuAction } from "./helpers/manage";

// Phone viewport.
test.use({ ...devices["Pixel 7"] });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

test("category icons: top-level and subcategory emojis, hex colour, ＋ adds a subcategory, show in rows, filters and drill-down", async ({ page }) => {
  const ts = Date.now();
  const parent = `E2E Icon Home ${ts}`;
  const child = `E2E Icon Sofa ${ts}`;
  const merchant = `ICONSHOP${ts}`;

  // Create the parent with an emoji found through search.
  await page.goto("/settings/categories?add=1");
  const addSheet = manageSheet(page);
  await addSheet.getByLabel("Name", { exact: true }).fill(parent);
  await addSheet.getByLabel("Or an exact colour").fill("1E3A8A");
  await pickCategoryIcon(page, addSheet, { search: "house", emoji: "🏠" });
  await expect(addSheet.getByRole("button", { name: "Change icon, currently 🏠" })).toBeVisible();
  await addSheet.getByRole("button", { name: "Add category" }).click();
  await expect(addSheet).toBeHidden();

  const parentRow = page.getByTestId("category-row").filter({ hasText: parent }).first();
  await expect(parentRow.getByTestId("category-icon")).toHaveText("🏠");

  // The hex field was normalised on save.
  await parentRow.getByRole("button", { name: `Edit ${parent}` }).click();
  await expect(manageSheet(page).getByLabel("Or an exact colour")).toHaveValue("#1e3a8a");
  await manageSheet(page).getByRole("button", { name: "Cancel" }).click();
  await expect(manageSheet(page)).toBeHidden();

  // ＋ on the row adds a subcategory; it can have its own emoji and flags a taken colour.
  await page.getByRole("button", { name: `Add a subcategory to ${parent}` }).click();
  const subSheet = manageSheet(page);
  await subSheet.getByLabel("Name", { exact: true }).fill(child);
  await subSheet.getByLabel("Or an exact colour").fill("#1e3a8a");
  await expect(subSheet.getByText(`Used by ${parent}`)).toBeVisible();
  await subSheet.getByLabel("Or an exact colour").fill("#0f766e");
  await expect(subSheet.getByText(/^Used by/)).toHaveCount(0);
  await pickCategoryIcon(page, subSheet, { search: "couch", emoji: "🛋️" });
  await subSheet.getByRole("button", { name: "Add category" }).click();
  await expect(subSheet).toBeHidden();
  const subList = page.getByRole("list", { name: `Subcategories of ${parent}` });
  await expect(subList.getByText(child)).toBeVisible();
  await expect(subList.getByTestId("category-icon")).toHaveText("🛋️");

  // Import one transaction and file it under the subcategory.
  const date = "01/05/2019";
  const label = `${merchant} R0`;
  const row = `${date};${label};CB ${label};REF0;REF0-;Carte;;;-10,00;;${date};${date};0`;
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: `icons-${ts}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, row].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await expect(page.getByText("1 imported")).toBeVisible();

  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  const txList = page.getByRole("list", { name: "Transactions" });
  await expect(txList.getByRole("button", { name: /^(Categorize|Select): / })).toHaveCount(1);
  await page.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("dialog", { name: "Options" }).getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "Select all loaded" }).click();
  // Native options carry each part's own emoji: "🏠 Parent > 🛋️ Child".
  await page.getByLabel("Category for selected transactions").selectOption({ label: `🏠 ${parent} > 🛋️ ${child}` });
  await page.getByRole("region", { name: "Bulk edit" }).getByRole("button", { name: "Apply" }).click();
  await expect(toastWith(page, "1 transaction updated")).toBeVisible();

  // A subcategory's row shows its own emoji.
  await expect(txList.getByTestId("category-icon")).toHaveText("🛋️");
  await expect(txList.getByTestId("category-dot")).toHaveCount(0);
  await page.getByTestId("filters-button").click();
  await expect(page.locator("#tx-category option", { hasText: `🏠 ${parent} > 🛋️ ${child}` })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // The Budget page's drill-down shows the subcategory's emoji on its row.
  await page.goto("/budget?month=2019-05");
  await page.getByRole("link", { name: new RegExp(`^${parent}`) }).click();
  await expect(page).toHaveURL(/category=/);
  await expect(page.getByRole("link", { name: new RegExp(`^${child}`) }).getByTestId("category-icon")).toHaveText("🛋️");

  // Remove the parent's icon: its colour dot comes back and the options lose the emoji.
  await page.goto("/settings/categories");
  await rowMenuAction(page, parent, "Rename, icon, colour");
  const editSheet = manageSheet(page);
  await editSheet.getByRole("button", { name: /^Change icon/ }).click();
  await page.getByRole("dialog", { name: "Choose an icon" }).getByRole("button", { name: "Remove icon" }).click();
  await expect(page.getByRole("dialog", { name: "Choose an icon" })).toBeHidden();
  await expect(editSheet.getByRole("button", { name: "Choose an icon" })).toBeVisible();
  await editSheet.getByRole("button", { name: "Save" }).click();
  await expect(editSheet).toBeHidden();
  await expect(page.getByTestId("category-row").filter({ hasText: parent }).first().getByTestId("category-dot")).toBeVisible();

  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  await page.getByTestId("filters-button").click();
  await expect(page.locator("#tx-category option", { hasText: `${parent} > ` })).toHaveText(`${parent} > 🛋️ ${child}`);

  // Clean up.
  await deleteCategory(page, child);
  await deleteCategory(page, parent);
});

test("category icons: French search finds an emoji by its French keyword", async ({ page, context, baseURL }) => {
  const ts = Date.now();
  const name = `E2E Icône ${ts}`;
  // The E2E user's language is "Automatic", so the locale cookie decides.
  await context.addCookies([{ name: "locale", value: "fr", url: baseURL ?? "http://localhost:3000" }]);
  try {
    await page.goto("/settings/categories?add=1");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const sheet = manageSheet(page);
    await sheet.getByLabel("Nom").fill(name);
    await pickCategoryIcon(page, sheet, { search: "maison", emoji: "🏠", buttonName: /^Choisir une icône$/ });
    await sheet.getByRole("button", { name: "Ajouter la catégorie" }).click();
    await expect(sheet).toBeHidden();
    const row = page.getByTestId("category-row").filter({ hasText: name }).first();
    await expect(row.getByTestId("category-icon")).toHaveText("🏠");
  } finally {
    await context.clearCookies({ name: "locale" });
    await deleteCategory(page, name);
  }
});
