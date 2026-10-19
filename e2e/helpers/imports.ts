import { expect, type Page } from "@playwright/test";

/** Undoes an import from the history's ⋯ menu (the row's only destructive item), confirming the dialog. */
export async function undoImport(page: Page, filename: string) {
  const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: filename });
  await row.getByRole("button", { name: `Options for ${filename}` }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
}

/**
 * Chooses a CSV on the import page and gets past the Columns step with the mapping franC filled in,
 * leaving the preview open. Works in English and French.
 */
export async function chooseCsv(page: Page, file: Parameters<ReturnType<Page["locator"]>["setInputFiles"]>[0]) {
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles(file);
  await page.getByRole("region", { name: /^(Match the columns|Associer les colonnes)$/ }).waitFor();
  await page.getByRole("button", { name: /^(Continue|Continuer)$/ }).click();
}
