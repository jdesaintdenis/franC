import { readFile } from "node:fs/promises";

import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

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

async function readDownload(page: Page, click: () => Promise<void>): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]);
  const path = await download.path();
  return (await readFile(path)).toString("utf-8");
}

test("export: transactions honour the page filters, categories download from settings", async ({ page }) => {
  const stamp = Date.now();
  const inside = `ZQEXPORTIN${stamp}`;
  const outside = `ZQEXPORTOUT${stamp}`;
  const file = `export-${stamp}.csv`;
  // A random month in 1995-1999 keeps the filter free of other specs' data.
  const year = 1995 + Math.floor(Math.random() * 5);
  const mm = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const otherMm = mm === "01" ? "02" : "01";
  const row = (label: string, month: string, amount: string) =>
    `10/${month}/${year};${label};PRLV ${label};REF1;REF1-;Prelevement;;;${amount};;10/${month}/${year};10/${month}/${year};0`;

  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: file,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, row(inside, mm, "-44,50"), row(outside, otherMm, "-12,00")].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByText("2 imported")).toBeVisible();

  try {
    await page.goto(`/transactions?from=${year}-${mm}-01&to=${year}-${mm}-28`);
    await expect(page.getByText("1 transaction", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Page options" }).click();
    const csv = await readDownload(page, () => page.getByRole("dialog", { name: "Options" }).getByRole("link", { name: "Export CSV" }).click());

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(
      "Date,Account,Label,Amount,Category,Subcategory,Split,Transaction amount,Internal transfer,Category source,Bank category,Bank subcategory,Bank label,Tags,Note",
    );
    const dataLines = lines.slice(1).filter((l) => l !== "");
    expect(dataLines).toHaveLength(1);
    expect(dataLines[0]).toContain(`${year}-${mm}-10`);
    expect(dataLines[0]).toContain(inside);
    expect(dataLines[0]).toContain(",-44.50,");
    expect(csv).not.toContain(outside);

    await page.goto("/settings/export");
    const categories = await readDownload(page, () => page.getByRole("link", { name: /^Categories/ }).click());
    expect(categories.charCodeAt(0)).toBe(0xfeff);
    expect(categories.slice(1).split("\r\n")[0]).toBe("Category,Subcategory,Color,Icon");
  } finally {
    await undoImport(page, file);
  }
});
