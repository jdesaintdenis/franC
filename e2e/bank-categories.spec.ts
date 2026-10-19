import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";
import { chooseCsv } from "./helpers/imports";

test.use({ ...devices["Pixel 7"] });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function csvRow(label: string, i: number, category: string, subcategory: string) {
  const date = `${String(1 + i).padStart(2, "0")}/04/2025`;
  const rowLabel = `${label} R${i}`;
  return `${date};${rowLabel};CB ${rowLabel};REF${i};;Carte bancaire;${category};${subcategory};-${10 + i},00;;${date};${date};0`;
}

test("import offers Create / Map / Ignore for new bank categories, and remembers the answers", async ({ page }) => {
  const ts = Date.now();
  const merchant = `BANKSHOP${ts}`;
  // Unique names: the E2E user is shared across specs and runs.
  const created = `Banque E2E ${ts}`;
  const createdSub = `Sous E2E ${ts}`;
  const ignored = `Ignoree E2E ${ts}`;
  const lines = [
    HEADER,
    csvRow(merchant, 0, created, createdSub),
    csvRow(merchant, 1, created, createdSub),
    csvRow(merchant, 2, ignored, "Autre"),
    // A placeholder is never offered.
    csvRow(merchant, 3, "A categoriser - sortie d'argent", "Paiement CB - a categoriser"),
  ];
  const file = { name: `bank-${ts}.csv`, mimeType: "text/csv", buffer: Buffer.from(lines.join("\n") + "\n", "utf-8") };

  await page.goto("/import");
  await chooseCsv(page, file);

  const section = page.getByRole("region", { name: /bank categor/ });
  await expect(section).toBeVisible();
  await expect(section.getByText(/A categoriser/)).toHaveCount(0);
  // Everything is preselected to Create; the per-category list is behind "Customise".
  await expect(section.getByRole("status")).toContainText("will be created in your categories");
  await section.getByRole("button", { name: "Choose" }).click();
  const sheet = page.getByRole("dialog", { name: /bank categor/ });
  await expect(sheet.getByRole("button", { name: "Create all" })).toBeVisible();

  const createdSelect = sheet.getByLabel(created, { exact: true });
  await expect(createdSelect.locator("option", { hasText: "Create" })).toHaveCount(1);
  await expect(createdSelect.locator("option", { hasText: "Ignore" })).toHaveCount(1);
  await createdSelect.selectOption({ label: "Create" });
  await sheet.getByLabel(`${createdSub} (in ${created})`).selectOption({ label: "Create" });
  await sheet.getByLabel(ignored, { exact: true }).selectOption({ label: "Ignore" });
  await sheet.getByLabel(`Autre (in ${ignored})`).selectOption({ label: "Ignore" });
  await sheet.getByRole("button", { name: "OK" }).click();
  await expect(section.getByRole("status")).toContainText("2 added");

  await page.getByRole("button", { name: "Import 4 transactions" }).click();
  await expect(page.getByText("4 imported")).toBeVisible();

  // The created subcategory categorizes its rows; ignored and placeholder rows stay uncategorized.
  await page.goto(`/transactions?q=${encodeURIComponent(merchant)}`);
  const list = page.getByRole("list", { name: "Transactions" });
  await expect(list.getByRole("button", { name: /^(Categorize|Select): / })).toHaveCount(4);
  await expect(list.getByText(createdSub, { exact: true })).toHaveCount(2);
  await list.getByRole("button", { name: /^(Categorize|Select): / }).filter({ hasText: createdSub }).first().click();
  await expect(page.getByRole("dialog").getByText("Set from the bank's category")).toBeVisible();
  await page.keyboard.press("Escape");

  // Re-importing asks nothing: both bank categories were answered.
  await page.goto("/import");
  await chooseCsv(page, file);
  await expect(page.getByRole("region", { name: "Import preview" }).getByText("All 4 transactions in this file are already in franC.")).toBeVisible();
  await expect(page.getByRole("region", { name: /bank categor/ })).toHaveCount(0);

  // The answers are editable in Settings.
  await page.goto("/settings/bank-categories");
  await expect(page.getByRole("heading", { name: "Bank categories" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: `Category for ${ignored}`, exact: true })).toBeVisible();
  await expect(page.getByLabel(`Category for ${created} > ${createdSub}`)).toBeVisible();
});
