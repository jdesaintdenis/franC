import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory, deleteCategoriesWithPrefix } from "./helpers/manage";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";

const PREFIX = "E2E Sheet";

// Each test imports, edits and cleans up after itself.
test.setTimeout(60_000);

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

/** Imports `count` rows that share one label, so a rule on that label matches all of them. */
async function importRows(page: Page, file: string, label: string, count: number) {
  const rows = Array.from({ length: count }, (_, i) => {
    const date = `${String(10 + i).padStart(2, "0")}/05/2025`;
    return `${date};${label};PRLV ${label};SH${i};SH${i}-;Prelevement;;;-${10 + i},00;;${date};${date};0`;
  });
  await page.goto("/import");
  // The preview starts by itself, even for a file chosen before the page hydrated.
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: file,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await expect(page.getByText(/^\d+ imported/)).toBeVisible();
}

async function cleanUp(page: Page, files: string[]) {
  for (const file of files) {
    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
    const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: file });
    if ((await row.count()) === 0) continue;
    await row.getByRole("button", { name: /^Options for / }).click();
    await page.getByRole("menuitem", { name: "Undo import" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(row).toHaveCount(0);
  }
  await deleteCategoriesWithPrefix(page, PREFIX);
}

function rowsOf(page: Page, label: string): Locator {
  return page.getByRole("list", { name: "Transactions" }).getByRole("button", { name: new RegExp(`^Categorize: ${label}`) });
}

function pick(sheet: Locator, category: string) {
  return sheet.getByTestId("category-picker").getByRole("button", { name: category, exact: true }).click();
}

function defineTests(viewport: string) {
  test.describe(viewport, () => {
    test("sheet: change the category (no Save button), see the toast, Undo", async ({ page }) => {
      const ts = Date.now();
      const label = `SHEETCAT${ts}X`;
      const file = `sheet-cat-${ts}.csv`;
      const category = `${PREFIX} Cat ${ts}`;
      try {
        await addCategory(page, category);
        await importRows(page, file, label, 1);

        await page.goto(`/transactions?q=${label}`);
        await rowsOf(page, label).click();
        const sheet = sheetOf(page);
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveAccessibleName(new RegExp(label));
        await expect(sheet.getByTestId("sheet-category")).toHaveAccessibleName("Category: Uncategorized");
        // Everything autosaves: no Save, Update or Add button anywhere in the sheet.
        await expect(sheet.getByRole("button", { name: /^(Save|Update|Add)\b/ })).toHaveCount(0);

        await sheet.getByTestId("sheet-category").click();
        await expect(sheet.getByRole("heading", { name: "Choose a category" })).toBeFocused();
        await expect(sheet.getByTestId("category-picker")).toBeVisible();
        await pick(sheet, category);

        // Back on the main view, saved, with the toast and the new category.
        await expect(sheet.getByTestId("sheet-step")).toBeHidden();
        await expect(sheet.getByTestId("sheet-category")).toHaveAccessibleName(`Category: ${category}`);
        await expect(toastWith(page, `Moved to ${category}`)).toBeVisible();

        await closeSheet(page);
        await expect(rowsOf(page, label)).toContainText(category);

        // Undo from the toast puts the old category back.
        await toastWith(page, `Moved to ${category}`).getByRole("button", { name: `Undo: Moved to ${category}` }).click();
        await expect(rowsOf(page, label)).toContainText("Uncategorized");
        await page.reload();
        await expect(rowsOf(page, label)).toContainText("Uncategorized");
        await expect(rowsOf(page, label)).not.toContainText(category);
      } finally {
        await cleanUp(page, [file]);
      }
    });

    test("sheet: a note autosaves and shows on the row; tags are added with Enter and removed", async ({ page }) => {
      const ts = Date.now();
      const label = `SHEETNOTE${ts}X`;
      const file = `sheet-note-${ts}.csv`;
      const note = `zqsheetnote ${ts}`;
      const tag = `sheettag${ts}`;
      try {
        await importRows(page, file, label, 1);

        await page.goto(`/transactions?q=${label}`);
        await rowsOf(page, label).click();
        const sheet = sheetOf(page);

        // Typing saves 1 s after the last key; closing flushes whatever is pending.
        await sheet.getByLabel("Note", { exact: true }).fill(note);
        await expect(sheet.getByText("Saved", { exact: true })).toBeVisible();
        await closeSheet(page);
        await expect(rowsOf(page, label).getByTestId("row-note")).toContainText(note);

        // Reopen: the note is there, and clearing it removes it.
        await rowsOf(page, label).click();
        await expect(sheet.getByLabel("Note", { exact: true })).toHaveValue(note);

        // A tag: Enter adds it, the chip's ✕ removes it, each with a toast.
        const tags = sheet.getByLabel("Tags", { exact: true });
        await tags.fill(tag);
        await tags.press("Enter");
        await expect(sheet.getByRole("button", { name: `Remove tag ${tag}` })).toBeVisible();
        await expect(toastWith(page, `Tag “${tag}” added`)).toBeVisible();
        await closeSheet(page);
        await expect(rowsOf(page, label).getByTestId("row-tags")).toContainText(tag);

        await rowsOf(page, label).click();
        await sheet.getByRole("button", { name: `Remove tag ${tag}` }).click();
        await expect(sheet.getByRole("button", { name: `Remove tag ${tag}` })).toHaveCount(0);
        await expect(toastWith(page, `Tag “${tag}” removed`)).toBeVisible();

        // Clearing the note removes it; the toast comes when the field loses focus or the sheet closes.
        await sheet.getByLabel("Note", { exact: true }).fill("");
        await closeSheet(page);
        await expect(toastWith(page, "Note removed")).toBeVisible();
        await expect(rowsOf(page, label).getByTestId("row-note")).toHaveCount(0);
        await expect(rowsOf(page, label).getByTestId("row-tags")).toHaveCount(0);
      } finally {
        await cleanUp(page, [file]);
      }
    });

    test("sheet: rule suggestion creates a rule, categorizes the others, and Undo reverts them", async ({ page }) => {
      const ts = Date.now();
      const label = `SHEETRULE${ts}X`;
      const file = `sheet-rule-${ts}.csv`;
      const category = `${PREFIX} Rule ${ts}`;
      try {
        await addCategory(page, category);
        await importRows(page, file, label, 3);

        await page.goto(`/transactions?q=${label}`);
        await expect(rowsOf(page, label)).toHaveCount(3);
        await rowsOf(page, label).first().click();
        const sheet = sheetOf(page);
        await sheet.getByTestId("sheet-category").click();
        await pick(sheet, category);

        // A hand change offers a one-tap rule built from the row's own name.
        const card = sheet.getByTestId("rule-suggestion");
        await expect(card).toContainText(`in ${category}?`);
        await expect(card).toContainText("Always put");
        await card.getByRole("button", { name: "Create rule" }).click();
        await expect(toastWith(page, "Rule created · 2 other transactions categorized")).toBeVisible();
        await expect(card).toHaveCount(0);

        await closeSheet(page);
        await expect(rowsOf(page, label).filter({ hasText: category })).toHaveCount(3);

        // Undo removes the rule and clears the rows it categorized, not the one set by hand.
        await toastWith(page, "Rule created").getByRole("button", { name: /^Undo/ }).click();
        await expect(rowsOf(page, label).filter({ hasText: category })).toHaveCount(1);
        await page.reload();
        await expect(rowsOf(page, label).filter({ hasText: category })).toHaveCount(1);
      } finally {
        await cleanUp(page, [file]);
      }
    });
  });
}

defineTests("desktop");

test.describe("phone", () => {
  // Pixel 7 dimensions by hand: spreading the device descriptor sets a browser type, which a describe group cannot.
  test.use({ viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true });
  defineTests("phone viewport");
});
