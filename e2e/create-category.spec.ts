import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory, deleteCategoriesWithPrefix } from "./helpers/manage";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";

const PREFIX = "E2E Create";

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

/** Touch-style horizontal drag on a row through pointer events (Playwright has no swipe API). */
async function swipe(row: Locator, dx: number) {
  await row.evaluate(async (el, distance) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - distance / 2;
    const y = rect.top + rect.height / 2;
    const fire = (type: string, clientX: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX, clientY: y }),
      );
    fire("pointerdown", x);
    for (const step of [0.25, 0.5, 0.75, 1]) fire("pointermove", x + distance * step);
    fire("pointerup", x + distance);
  }, dx);
}

async function openSheetPicker(page: Page, label: string) {
  await page.goto(`/transactions?q=${label}`);
  await rowsOf(page, label).click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("sheet-category").click();
  return sheet;
}

test("create category: search a missing name, Create and use", async ({ page }) => {
  const ts = Date.now();
  const label = `CREATECAT${ts}X`;
  const file = `create-cat-${ts}.csv`;
  const parent = `${PREFIX} Parent ${ts}`;
  const name = `${PREFIX} New ${ts}`;
  try {
    await addCategory(page, parent);
    await importRows(page, file, label, 1);
    const sheet = await openSheetPicker(page, label);

    await sheet.getByLabel("Search categories").fill(name);
    await expect(sheet.getByText(/No category matches/)).toBeVisible();
    await sheet.getByTestId("picker-create").click();
    await expect(sheet.getByRole("heading", { name: "New category" })).toBeVisible();
    const nameField = sheet.getByLabel("Name", { exact: true });
    await expect(nameField).toBeFocused();
    await expect(nameField).toHaveValue(name);
    await expect(sheet.getByRole("radio", { name: "None (top-level)" })).toBeChecked();

    // One heading and one Back; Back returns to the list with the search kept, nothing created yet.
    await expect(sheet.getByRole("heading", { name: "Choose a category" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Back" })).toHaveCount(1);
    await sheet.getByRole("button", { name: "Back" }).click();
    await expect(sheet.getByRole("heading", { name: "Choose a category" })).toBeVisible();
    await expect(sheet.getByLabel("Search categories")).toHaveValue(name);
    await sheet.getByTestId("picker-create").click();

    await sheet.getByRole("button", { name: "Create and use" }).click();
    await expect(sheet.getByTestId("sheet-step")).toBeHidden();
    await expect(sheet.getByTestId("sheet-category")).toHaveAccessibleName(`Category: ${name}`);
    await expect(toastWith(page, `Moved to ${name}`)).toBeVisible();
    await closeSheet(page);
    await expect(rowsOf(page, label)).toContainText(name);

    // Undo puts the old category back and keeps the new one.
    await toastWith(page, `Moved to ${name}`).getByRole("button", { name: `Undo: Moved to ${name}` }).click();
    await expect(rowsOf(page, label)).toContainText("Uncategorized");
    await page.goto("/settings/categories");
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  } finally {
    await cleanUp(page, [file]);
  }
});

test("create category: a taken name stays an inline error", async ({ page }) => {
  const ts = Date.now();
  const label = `CREATETAKEN${ts}X`;
  const file = `create-taken-${ts}.csv`;
  const existing = `${PREFIX} Taken ${ts}`;
  try {
    await addCategory(page, existing);
    await importRows(page, file, label, 1);
    const sheet = await openSheetPicker(page, label);

    await sheet.getByLabel("Search categories").fill(`${PREFIX} Other ${ts}`);
    await sheet.getByTestId("picker-create").click();
    await sheet.getByLabel("Name", { exact: true }).fill(existing);
    await sheet.getByRole("button", { name: "Create and use" }).click();
    await expect(sheet.getByRole("alert").filter({ hasText: "A category with this name already exists." })).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "New category" })).toBeVisible();
    await expect(sheet.getByTestId("sheet-category")).toBeHidden();
  } finally {
    await cleanUp(page, [file]);
  }
});

test("create category: searching a subcategory name pre-selects its parent", async ({ page }) => {
  const ts = Date.now();
  const label = `CREATESUB${ts}X`;
  const file = `create-sub-${ts}.csv`;
  const parent = `${PREFIX} P ${ts}`;
  try {
    await addCategory(page, parent);
    await addCategory(page, `${PREFIX} Sub ${ts}`, { parent });
    await importRows(page, file, label, 1);
    const sheet = await openSheetPicker(page, label);

    await sheet.getByLabel("Search categories").fill(`Sub ${ts}`);
    await sheet.getByTestId("picker-create").click();
    await expect(sheet.getByRole("radiogroup", { name: "Parent category" }).getByRole("radio", { name: parent, exact: true })).toBeChecked();
  } finally {
    await cleanUp(page, [file]);
  }
});

test.describe("phone", () => {
  test.use({ viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true });

  test("create category: from the swipe picker", async ({ page }) => {
    const ts = Date.now();
    const label = `CREATESWIPE${ts}X`;
    const file = `create-swipe-${ts}.csv`;
    const name = `${PREFIX} Swipe ${ts}`;
    try {
      await importRows(page, file, label, 1);
      await page.goto(`/transactions?q=${label}`);
      await swipe(rowsOf(page, label).first(), 220);
      const picker = page.getByRole("dialog", { name: "Change category" });
      await picker.getByLabel("Search categories").fill(name);
      await picker.getByTestId("picker-create").click();
      await picker.getByRole("button", { name: "Create and use" }).click();
      await expect(picker).toBeHidden();
      await expect(rowsOf(page, label).first()).toContainText(name);
    } finally {
      await cleanUp(page, [file]);
    }
  });
});

test("create category: New category… in bulk edit applies to the selection", async ({ page }) => {
  const ts = Date.now();
  const label = `CREATEBULK${ts}X`;
  const file = `create-bulk-${ts}.csv`;
  const name = `${PREFIX} Bulk ${ts}`;
  try {
    // A bulk select needs at least one category to show up.
    await addCategory(page, `${PREFIX} Anchor ${ts}`);
    await importRows(page, file, label, 2);
    await page.goto(`/transactions?q=${label}`);
    await page.getByRole("button", { name: "Page options" }).click();
    await page.getByRole("dialog", { name: "Options" }).getByRole("button", { name: "Select" }).click();
    await page.getByRole("button", { name: "Select all loaded" }).click();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByLabel("Category for selected transactions").selectOption({ label: "New category…" });
    const sheet = page.getByRole("dialog", { name: "New category" });
    await sheet.getByLabel("Name", { exact: true }).fill(name);
    await sheet.getByRole("button", { name: "Create and use" }).click();
    await expect(toastWith(page, "2 transactions updated")).toBeVisible();
    await expect(page.getByRole("list", { name: "Transactions" }).getByText(name, { exact: true })).toHaveCount(2);
  } finally {
    await cleanUp(page, [file]);
  }
});
