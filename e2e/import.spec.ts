import { expect, test } from "./fixtures";
import { chooseCsv } from "./helpers/imports";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function debitRow(date: string, label: string, debit: string) {
  return `${date};${label};PRLV ${label};REF1;REF1-;Prelevement;;;${debit};;${date};${date};0`;
}

function buildCsv(label: string) {
  const lines = [
    HEADER,
    debitRow("29/09/2025", label, "-12,50"),
    debitRow("29/09/2025", label, "-12,50"),
    debitRow("30/09/2025", `${label}-B`, "-3,20"),
    debitRow("not-a-date", label, "-1,00"),
  ];
  return Buffer.from(lines.join("\n") + "\n", "utf-8");
}

test("import: preview, confirm, then re-import is fully deduplicated", async ({ page }) => {
  const preview = page.getByRole("region", { name: "Import preview" });
  const result = page.getByRole("region", { name: "Import result" });
  const buffer = buildCsv(`E2E-${Date.now()}`);
  const file = { name: "export.csv", mimeType: "text/csv", buffer };

  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import", exact: true })).toBeVisible();
  await chooseCsv(page, file);

  await expect(preview.getByTestId("import-new-count")).toHaveText("3");
  await expect(preview.getByText("1 unreadable line won't be imported.")).toBeVisible();
  await preview.getByText("See which").click();
  await expect(preview.getByText(/Line 5:/)).toBeVisible();

  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(result.getByText("3 imported")).toBeVisible();

  await page.getByRole("button", { name: "Import another file" }).click();
  await chooseCsv(page, file);

  await expect(preview.getByText("Nothing new")).toBeVisible();
  await expect(preview.getByText("All 3 transactions in this file are already in franC.")).toBeVisible();
  // Nothing to record: the only way on is another file (Slice 62).
  await expect(page.getByRole("button", { name: /^Import \d+ transactions?$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose another file" }).click();
  await expect(page.getByText("Choose the CSV file")).toBeVisible();
});

test("import: a file with no table shows a file error", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: "wrong.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("just a sentence, not a table\n", "utf-8"),
  });
  await expect(page.getByRole("alert").filter({ hasText: "No table found in this file" })).toBeVisible();
});

test("import history: undo then re-import cleanly", async ({ page }) => {
  const stamp = Date.now();
  const file = { name: `undo-${stamp}.csv`, mimeType: "text/csv", buffer: buildCsv(`E2E-UNDO-${stamp}`) };
  const historyRow = page
    .getByRole("list", { name: "Import history" })
    .getByRole("listitem")
    .filter({ hasText: file.name });
  const preview = page.getByRole("region", { name: "Import preview" });
  const result = page.getByRole("region", { name: "Import result" });

  await page.goto("/import");
  await chooseCsv(page, file);
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(result.getByText("3 imported")).toBeVisible();

  await expect(historyRow).toHaveCount(1);
  await expect(historyRow).toContainText("3 transactions · 1 unreadable");

  await historyRow.getByRole("button", { name: /^Options for / }).click();

  await page.getByRole("menuitem", { name: "Undo import" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("3 transactions");
  await dialog.getByRole("button", { name: "Undo import" }).click();
  await expect(dialog).toBeHidden();
  await expect(historyRow).toHaveCount(0);

  await page.getByRole("button", { name: "Import another file" }).click();
  await chooseCsv(page, file);
  await expect(preview.getByTestId("import-new-count")).toHaveText("3");
});
