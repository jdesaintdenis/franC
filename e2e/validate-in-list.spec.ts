import { devices, type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory, deleteCategoriesWithPrefix } from "./helpers/manage";
import { clearQueue } from "./helpers/queue";
import { settled } from "./helpers/recurring";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";

// Validating from the list (SPEC §73): ✓ on rows that have a category, no ✓ without one.
test.use({ ...devices["Pixel 7"] });
test.setTimeout(90_000);

const PREFIX = "E2E Validate";
const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

async function importRows(page: Page, file: string, label: string, count: number) {
  const rows = Array.from({ length: count }, (_, i) => {
    const date = `${String(10 + i).padStart(2, "0")}/05/2025`;
    return `${date};${label}${i};PRLV ${label}${i};VL${i};VL${i}-;Prelevement;;;-${10 + i},00;;${date};${date};0`;
  });
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: file,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await expect(page.getByText(/^\d+ imported/)).toBeVisible();
}

test("validate in the list: ✓ needs a category, Undo, sheet validation, no sideways scroll", async ({ page, sql, workerUser }) => {
  const ts = Date.now();
  const label = `VLIST${ts}X`;
  const file = `validate-${ts}.csv`;
  const category = `${PREFIX} ${ts}`;
  await clearQueue(page, sql, workerUser);
  await addCategory(page, category);
  try {
    await importRows(page, file, label, 3);

    // One row gets a category without being validated (a guess made by hand in the database).
    const [cat] = await sql`select id from categories where user_id = ${workerUser.id} and name = ${category}`;
    await sql`
      update transactions set category_id = ${cat.id}, category_source = 'manual'
      where user_id = ${workerUser.id} and label_normalized like ${`%${label}0%`}`;

    await page.goto(`/transactions?q=${label}`);
    const marks = page.getByTestId("row-to-review");
    await expect(marks).toHaveCount(3);
    // Only the categorized row can be validated; the two bare ones have no ✓.
    await expect(page.getByTestId("row-validate")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await expect(page.getByTestId("row-validated")).toHaveCount(0);
    await page.getByTestId("row-validate").click();
    await expect(marks).toHaveCount(2);
    // The empty ring on the icon becomes a filled ✓.
    await expect(page.getByTestId("row-validated")).toHaveCount(1);
    const validated = toastWith(page, "Validated");
    await expect(validated).toBeVisible();
    // Undo puts the row back in the queue.
    await validated.getByRole("button", { name: /^Undo/ }).click();
    await expect(marks).toHaveCount(3);

    // The save runs behind the screen: wait for the server before reloading.
    await settled(page, () => page.getByTestId("row-validate").click());
    await expect(marks).toHaveCount(2);
    await page.reload();
    await expect(page.getByTestId("row-to-review")).toHaveCount(2);

    // A bare row: its sheet has no Validate button, picking a category validates it.
    await page.getByRole("button", { name: /^Categorize: / }).first().click();
    const sheet = sheetOf(page);
    await expect(sheet.getByTestId("sheet-validate")).toHaveCount(0);
    await expect(sheet.getByTestId("sheet-new-category")).toBeVisible();
    await sheet.getByTestId("sheet-category").click();
    await sheet.getByTestId("category-picker").getByRole("button", { name: category, exact: true }).click();
    await closeSheet(page);
    await expect(page.getByTestId("row-to-review")).toHaveCount(1);
  } finally {
    await page.goto("/import");
    const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: file });
    if ((await row.count()) > 0) {
      await row.getByRole("button", { name: /^Options for / }).click();
      await page.getByRole("menuitem", { name: "Undo import" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
      await expect(page.getByRole("alertdialog")).toBeHidden();
    }
    await deleteCategoriesWithPrefix(page, PREFIX);
  }
});
