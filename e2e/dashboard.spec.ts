import { formatCents, formatSignedWholeCents, formatWholeCents } from "../src/lib/money";

import { expect, test } from "./fixtures";
import { chooseCsv } from "./helpers/imports";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function row(date: string, label: string, debit: string, credit: string) {
  return `${date};${label};PRLV ${label};REF1;REF1-;Prelevement;;;${debit};${credit};${date};${date};0`;
}


test("dashboard: totals, month navigation and category drill-down", async ({ page }) => {
  const stamp = Date.now();
  const label = `E2E-DASH-${stamp}`;
  // A random month in 2001-2010 keeps the totals free of other specs' data.
  const year = 2001 + Math.floor(Math.random() * 10);
  const mm = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const month = `${year}-${mm}`;
  const file = {
    name: `dash-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        HEADER,
        row(`10/${mm}/${year}`, `${label}-A`, "-12,50", ""),
        row(`11/${mm}/${year}`, `${label}-B`, "-30,00", ""),
        row(`12/${mm}/${year}`, `${label}-C`, "", "100,00"),
      ].join("\n") + "\n",
      "utf-8",
    ),
  };
  const result = page.getByRole("region", { name: "Import result" });
  const historyRow = page
    .getByRole("list", { name: "Import history" })
    .getByRole("listitem")
    .filter({ hasText: file.name });

  await page.goto("/import");
  await chooseCsv(page, file);
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(result.getByText("3 imported")).toBeVisible();

  try {
    await page.goto(`/budget?month=${month}`);
    const card = page.getByTestId("month-card");
    await expect(card.getByTestId("month-spent")).toContainText(formatWholeCents(4250, "en"));
    await expect(card).toContainText(`Income ${formatCents(10000, "en")}`);
    await expect(card).toContainText(`net ${formatSignedWholeCents(5750, "en")}`);

    // No horizontal overflow on a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByRole("link", { name: "Next month", exact: true }).click();
    await expect(page).toHaveURL(/\/budget\?month=\d{4}-\d{2}$/);
    await expect(page).not.toHaveURL(new RegExp(`month=${month}$`));
    await page.getByRole("link", { name: "Previous month", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`month=${month}$`));

    await page.getByRole("link", { name: /^Uncategorized/ }).click();
    await expect(page).toHaveURL(/\/transactions\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("from")).toBe(`${month}-01`);
    expect(url.searchParams.get("category")).toBe("none");
    expect(url.searchParams.get("direction")).toBe("out");
    await expect(page.getByText(`${label}-A`).first()).toBeVisible();
    await expect(page.getByText(`${label}-B`).first()).toBeVisible();
    await expect(page.getByText(`${label}-C`)).toHaveCount(0);
  } finally {
    // Undo so reruns stay deterministic.
    await page.goto("/import");
    await historyRow.getByRole("button", { name: /^Options for / }).click();
    await page.getByRole("menuitem", { name: "Undo import" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(historyRow).toHaveCount(0);
  }
});
