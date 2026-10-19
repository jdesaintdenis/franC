import { devices } from "@playwright/test";

import { expect, test } from "./fixtures";
import { manageSheet, openMenu, rowMenuAction } from "./helpers/manage";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";
import { chooseCsv } from "./helpers/imports";

// Phone viewport.
test.use({ ...devices["Pixel 7"] });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

// The worker's E2E user is shared by the specs it runs and must end up without merchants.
test.afterEach(async ({ page }) => {
  await page.goto("/settings/merchants");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const options = page.getByRole("button", { name: /^Options for / });
  while ((await options.count()) > 0) {
    const before = await options.count();
    await options.first().click();
    await openMenu(page).getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(options).toHaveCount(before - 1);
  }
});

test("merchants: rename from a row, see it in the list, search and Settings, then delete", async ({ page }) => {
  const ts = Date.now();
  const shortLabel = `ZQMERCH${ts}`;
  const name = `Zq Shop ${ts}`;
  const rows = [0, 1].map((i) => {
    const date = `${String(5 + i).padStart(2, "0")}/04/2025`;
    return `${date};${shortLabel};PRLV ${shortLabel} SA-${i};REF${i};REF${i}-;Prelevement;;;-${20 + i},00;;${date};${date};0`;
  });

  await page.goto("/import");
  await chooseCsv(page, {
    name: `merchants-${ts}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByText("2 imported")).toBeVisible();

  await page.goto(`/transactions?q=${encodeURIComponent(shortLabel)}`);
  const list = page.getByRole("list", { name: "Transactions" });
  await expect(list.getByRole("button", { name: /^(Categorize|Select): / })).toHaveCount(2);

  await list.getByRole("button", { name: /^(Categorize|Select): / }).first().click();
  const dialog = sheetOf(page);
  // The bank's short label is the title until a name is given; the raw label is under it.
  await expect(dialog.getByText("Bank label:")).toBeVisible();
  await dialog.getByRole("button", { name: "Rename merchant" }).click();
  // Safe default: is exactly + the bank's short label, with a live count.
  await expect(dialog.getByLabel("Match labels that")).toHaveValue("equals");
  await expect(dialog.getByLabel("Pattern")).toHaveValue(shortLabel);
  await expect(dialog.getByText("Renames 2 transactions")).toBeVisible();
  await dialog.getByLabel("Merchant name").fill(name);
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(toastWith(page, /Merchant saved · 2 transactions renamed/)).toBeVisible();
  await closeSheet(page);

  // Both rows show the new name; search finds it by the name and by the bank label.
  await expect(list.getByText(name, { exact: true })).toHaveCount(2);
  await page.goto(`/transactions?q=${encodeURIComponent(name)}`);
  await expect(list.getByRole("button", { name: /^(Categorize|Select): / })).toHaveCount(2);

  // The dialog keeps the raw bank label visible.
  await list.getByRole("button", { name: /^(Categorize|Select): / }).first().click();
  await expect(dialog.getByText(new RegExp(`Bank label: PRLV ${shortLabel} SA-\\d`))).toBeVisible();
  await expect(dialog).toHaveAccessibleName(name);
  await closeSheet(page);

  // Manage it in Settings: the row says what it holds, its sheet shows the patterns.
  await page.goto("/settings/merchants");
  const merchants = page.getByRole("list", { name: "Merchant names" });
  const item = merchants.getByRole("listitem").filter({ hasText: name });
  await expect(item).toContainText("2 transactions · 1 pattern");
  await item.getByRole("button").first().click();
  const sheet = manageSheet(page);
  await expect(sheet).toHaveAccessibleName(name);
  await expect(sheet.getByLabel("Merchant name")).toHaveValue(name);
  await expect(sheet.getByRole("list", { name: `Labels matched by ${name}` })).toContainText(`is exactly ${shortLabel}`);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Delete is immediate: the rows go back to the bank's label, and Undo brings the name back.
  await rowMenuAction(page, name, "Delete");
  await expect(toastWith(page, `${name} deleted`)).toBeVisible();
  await expect(item).toHaveCount(0);
  await page.goto(`/transactions?q=${encodeURIComponent(shortLabel)}`);
  await expect(list.getByRole("button", { name: /^(Categorize|Select): / })).toHaveCount(2);
  await expect(list).not.toContainText(name);
  await expect(list).toContainText(shortLabel);
});

test("merchants: delete with Undo gives the name back to its transactions", async ({ page }) => {
  const ts = Date.now();
  const shortLabel = `ZQUNDO${ts}`;
  const name = `Zq Undo ${ts}`;
  const date = "07/04/2025";
  const row = `${date};${shortLabel};PRLV ${shortLabel} SA;REF0;REF0-;Prelevement;;;-12,00;;${date};${date};0`;
  await page.goto("/import");
  await chooseCsv(page, {
    name: `merchant-undo-${ts}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, row].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await expect(page.getByText("1 imported")).toBeVisible();

  // Add through the header sheet.
  await page.goto("/settings/merchants");
  await page.getByRole("link", { name: "Add", exact: true }).click();
  const sheet = manageSheet(page);
  await sheet.getByLabel("Merchant name").fill(name);
  await sheet.getByLabel("Pattern").fill(shortLabel);
  await sheet.getByRole("button", { name: "Add merchant" }).click();
  await expect(sheet).toBeHidden();
  await expect(toastWith(page, /Merchant added · 1 transaction renamed/)).toBeVisible();

  const transactions = page.getByRole("list", { name: "Transactions" });
  const item = page.getByRole("list", { name: "Merchant names" }).getByRole("listitem").filter({ hasText: name });
  await expect(item).toContainText("1 transaction · 1 pattern");

  // Delete: the transaction goes back to the bank label, and Undo brings the name back.
  await rowMenuAction(page, name, "Delete");
  await expect(item).toHaveCount(0);
  await toastWith(page, `${name} deleted`).getByRole("button", { name: "Undo" }).click();
  await expect(item).toContainText("1 transaction · 1 pattern");
  await page.goto(`/transactions?q=${encodeURIComponent(name)}`);
  await expect(transactions).toContainText(name);
  await page.goto("/settings/merchants");
  await item.getByRole("button").first().click();
  await expect(manageSheet(page).getByRole("list", { name: `Labels matched by ${name}` })).toContainText(`is exactly ${shortLabel}`);
});
