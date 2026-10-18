import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { manageSheet, rowMenuAction } from "./helpers/manage";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";

test.use({ actionTimeout: 10_000 });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

async function undoImport(page: Page, fileName: string) {
  await page.goto("/import");
  const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: fileName });
  await row.getByRole("button", { name: /^Options for / }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row).toHaveCount(0);
}

/** Deletes a tag from Settings > Tags if it is still there (cleanup after a failed run). */
async function deleteTagIfPresent(page: Page, name: string) {
  await page.goto("/settings/tags");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const trigger = page.getByRole("button", { name: `Options for ${name}`, exact: true });
  if ((await trigger.count()) === 0) return;
  await rowMenuAction(page, name, "Delete");
  await expect(trigger).toHaveCount(0);
}

// Several page loads and a cleanup pass on a dev server that compiles on demand.
test.setTimeout(120_000);

test("tags: note found by search, bulk tag, filter with total, rename and delete in Settings", async ({ page }) => {
  const stamp = Date.now();
  const prefix = `ZQTAG${stamp}`;
  const noteText = `zqnote${stamp} remember the receipt`;
  const tagName = `Trip ${stamp}`;
  const renamed = `Journey ${stamp}`;
  const file = `tags-${stamp}.csv`;
  const lines = [
    `05/03/2005;${prefix} A;PRLV ${prefix} A;R1;R1-;Prelevement;;;-20,00;;05/03/2005;05/03/2005;0`,
    `06/03/2005;${prefix} B;PRLV ${prefix} B;R2;R2-;Prelevement;;;-30,00;;06/03/2005;06/03/2005;0`,
    `07/03/2005;${prefix} C;PRLV ${prefix} C;R3;R3-;Prelevement;;;-40,00;;07/03/2005;07/03/2005;0`,
  ];

  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: file,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, ...lines].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(page.getByText("3 imported")).toBeVisible();

  const rowButton = (suffix: string) => page.getByRole("button", { name: new RegExp(`^Categorize: ${prefix} ${suffix}`) });

  try {
    // Note: saved from the dialog, shown on the row, found by search.
    await page.goto(`/transactions?q=${prefix}`);
    await rowButton("A").click();
    const dialog = sheetOf(page);
    await dialog.getByLabel("Note", { exact: true }).fill(noteText);
    // Autosaves; closing the sheet flushes it at once and says so.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(toastWith(page, "Note saved")).toBeVisible();
    await expect(rowButton("A").getByTestId("row-note")).toContainText(noteText);

    await page.goto(`/transactions?q=zqnote${stamp}`);
    await expect(page.getByRole("list", { name: "Transactions" }).getByRole("button", { name: /^Categorize: / })).toHaveCount(1);
    await expect(rowButton("A")).toBeVisible();

    // Tag one row from the dialog: chip on the row, suggestion for later.
    await page.goto(`/transactions?q=${prefix}`);
    await rowButton("C").click();
    await dialog.getByLabel("Tags", { exact: true }).fill(`Solo ${stamp}`);
    await dialog.getByLabel("Tags", { exact: true }).press("Enter");
    await expect(dialog.getByRole("button", { name: `Remove tag Solo ${stamp}` })).toBeVisible();
    await dialog.getByRole("button", { name: `Remove tag Solo ${stamp}` }).click();
    await expect(dialog.getByRole("button", { name: `Remove tag Solo ${stamp}` })).toHaveCount(0);
    await closeSheet(page);

    // Bulk: select rows A and B, add a tag.
    await page.getByRole("button", { name: "Page options" }).click();
    await page.getByRole("dialog", { name: "Options" }).getByRole("button", { name: "Select" }).click();
    await page.getByRole("checkbox", { name: new RegExp(`${prefix} A`) }).click();
    await page.getByRole("checkbox", { name: new RegExp(`${prefix} B`) }).click();
    const bar = page.getByRole("region", { name: "Bulk edit" });
    await bar.getByRole("button", { name: "Tag", exact: true }).click();
    await bar.getByLabel("Tag to add to selected transactions").fill(tagName);
    await bar.getByRole("button", { name: "Add tag" }).click();
    await expect(page.getByText("2 transactions tagged")).toBeVisible();
    await expect(rowButton("A").getByTestId("row-tags")).toContainText(tagName);
    await expect(rowButton("C").getByTestId("row-tags")).toHaveCount(0);

    // Filter by the tag: only A and B, with their total.
    await page.getByTestId("filters-button").click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await sheet.getByLabel("Tag", { exact: true }).selectOption({ label: tagName });
    await sheet.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/tag=/);
    await expect(page.getByRole("link", { name: `Remove filter: Tag: ${tagName}` })).toBeVisible();
    await expect(page.getByText(/^2 transactions · .*50\.00$/)).toBeVisible();
    await expect(rowButton("A")).toBeVisible();
    await expect(rowButton("C")).toHaveCount(0);

    // Settings > Tags: count, link to the filtered list, rename, delete (with Undo).
    await page.goto("/settings/tags");
    const tagRows = page.getByRole("list", { name: "Tags" }).getByTestId("tag-row");
    const tagRow = tagRows.filter({ hasText: tagName });
    await expect(tagRow).toContainText("2 transactions");
    await page.getByRole("button", { name: `Options for ${tagName}`, exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "See transactions" })).toHaveAttribute("href", /\/transactions\?tag=/);
    await page.keyboard.press("Escape");

    // Tapping the row opens the same rename sheet as the menu.
    await tagRow.getByRole("button", { name: `Rename ${tagName}` }).click();
    const rename = manageSheet(page);
    await rename.getByLabel("Tag name").fill(renamed);
    await rename.getByRole("button", { name: "Save", exact: true }).click();
    await expect(rename).toBeHidden();
    const renamedRow = tagRows.filter({ hasText: renamed });
    await expect(renamedRow).toContainText("2 transactions");

    // Renaming to a name another tag already has (any case) is refused; "Solo" still exists.
    await rowMenuAction(page, renamed, "Rename");
    await rename.getByLabel("Tag name").fill(`SOLO ${stamp}`);
    await rename.getByRole("button", { name: "Save", exact: true }).click();
    await expect(rename.getByText("A tag with this name already exists")).toBeVisible();
    await rename.getByRole("button", { name: "Cancel" }).click();
    await expect(rename).toBeHidden();

    // Delete is immediate; Undo brings the tag back with the same two transactions.
    await rowMenuAction(page, renamed, "Delete");
    await expect(page.getByText(`${renamed} deleted`)).toBeVisible();
    await expect(renamedRow).toHaveCount(0);
    await page.getByRole("button", { name: `Undo: ${renamed} deleted` }).click();
    await expect(renamedRow).toContainText("2 transactions");

    await rowMenuAction(page, renamed, "Delete");
    await expect(renamedRow).toHaveCount(0);

    // The transactions are still there, without the tag.
    await page.goto(`/transactions?q=${prefix}`);
    await expect(page.locator("#main").getByText(/^3 transactions/)).toBeVisible();
    await expect(rowButton("A").getByTestId("row-tags")).toHaveCount(0);
  } finally {
    await deleteTagIfPresent(page, tagName);
    await deleteTagIfPresent(page, renamed);
    await deleteTagIfPresent(page, `Solo ${stamp}`);
    await undoImport(page, file);
  }
});
