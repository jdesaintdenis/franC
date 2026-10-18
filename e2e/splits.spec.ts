import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory, deleteCategoriesWithPrefix } from "./helpers/manage";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

// Every category this spec creates carries the prefix so afterEach can remove it after a failure.
const PREFIX = "E2E Split";

test.afterEach(async ({ page }) => {
  await deleteCategoriesWithPrefix(page, PREFIX);
});

async function undoImport(page: Page, fileName: string) {
  await page.goto("/import");
  const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: fileName });
  await row.getByRole("button", { name: /^Options for / }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row).toHaveCount(0);
}

test("splits: split a transaction between two categories, see it in the chart, remove it", async ({ page }) => {
  const stamp = Date.now();
  const nameA = `${PREFIX} A ${stamp}`;
  const nameB = `${PREFIX} B ${stamp}`;
  const label = `ZQSPLIT${stamp}`;
  const file = `splits-${stamp}.csv`;
  // A random month in 2005-2009 keeps the chart free of other specs' data.
  const year = 2005 + Math.floor(Math.random() * 5);
  const mm = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const month = `${year}-${mm}`;
  const date = `10/${mm}/${year}`;

  await addCategory(page, nameA);
  await addCategory(page, nameB);

  const line = `${date};${label};PRLV ${label};REF1;REF1-;Prelevement;;;-44,50;;${date};${date};0`;
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: file,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, line].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await expect(page.getByText("1 imported")).toBeVisible();

  const rowButton = () => page.getByRole("button", { name: new RegExp(`^Categorize: ${label} `) });

  try {
    await page.goto(`/transactions?q=${label}`);
    await rowButton().click();
    const dialog = sheetOf(page);
    await dialog.getByTestId("sheet-split").click();

    // Starts as one part with the full amount; the rule "2 parts, all assigned" gates Save.
    await expect(dialog.getByLabel("Amount (part 1)")).toHaveValue("44.50");
    await expect(dialog.getByRole("button", { name: "Save split" })).toBeDisabled();
    await dialog.getByLabel("Category (part 1)").selectOption({ label: nameA });
    await dialog.getByLabel("Amount (part 1)").fill("32,10");
    await expect(dialog.getByTestId("split-remainder")).toHaveText("€12.40 left to assign");

    // Adding a part pre-fills what is left.
    await dialog.getByRole("button", { name: "Add part" }).click();
    await expect(dialog.getByLabel("Amount (part 2)")).toHaveValue("12.40");
    await expect(dialog.getByRole("button", { name: "Save split" })).toBeDisabled(); // no category yet
    await dialog.getByLabel("Category (part 2)").selectOption({ label: nameB });
    await expect(dialog.getByTestId("split-remainder")).toHaveText("Fully assigned");

    // Over-assigning is reported and blocks saving.
    await dialog.getByLabel("Amount (part 2)").fill("13");
    await expect(dialog.getByTestId("split-remainder")).toHaveText("Over by €0.60");
    await expect(dialog.getByRole("button", { name: "Save split" })).toBeDisabled();
    await dialog.getByLabel("Amount (part 2)").fill("12,40");

    await dialog.getByRole("button", { name: "Save split" }).click();
    await expect(toastWith(page, "Split saved")).toBeVisible();
    await closeSheet(page);
    await expect(rowButton().getByTestId("split-chip")).toContainText(`Split · ${nameA}, ${nameB}`);

    // The dashboard chart counts each part in its own category.
    await page.goto(`/budget?month=${month}`);
    await expect(page.getByRole("link", { name: new RegExp(`^${nameA}`) })).toContainText("€32.10");
    await expect(page.getByRole("link", { name: new RegExp(`^${nameB}`) })).toContainText("€12.40");

    // Drill-down: the full amount plus the matching part.
    await page.getByRole("link", { name: new RegExp(`^${nameA}`) }).click();
    await expect(rowButton()).toContainText("€44.50");
    await expect(rowButton()).toContainText(`${nameA}: €32.10`);

    // Reopen straight in the editor, then remove the split (with confirmation).
    await page.goto(`/transactions?q=${label}`);
    await rowButton().click();
    await dialog.getByTestId("sheet-split-parts").click();
    await expect(dialog.getByLabel("Amount (part 1)")).toHaveValue("32.10");
    await dialog.getByRole("button", { name: "Remove split" }).click();
    await dialog.getByRole("button", { name: "Yes, remove split" }).click();
    await expect(toastWith(page, "Split removed")).toBeVisible();
    await closeSheet(page);
    await expect(rowButton().getByTestId("split-chip")).toHaveCount(0);
    await expect(rowButton()).toContainText("Uncategorized");

    await page.goto(`/budget?month=${month}`);
    await expect(page.getByRole("link", { name: new RegExp(`^${nameA}`) })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Uncategorized/ })).toContainText("€44.50");
  } finally {
    await undoImport(page, file);
  }
});
