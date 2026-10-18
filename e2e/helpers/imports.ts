import { expect, type Page } from "@playwright/test";

/** Undoes an import from the history's ⋯ menu (the row's only destructive item), confirming the dialog. */
export async function undoImport(page: Page, filename: string) {
  const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: filename });
  await row.getByRole("button", { name: `Options for ${filename}` }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
}
