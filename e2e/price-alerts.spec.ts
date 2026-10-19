import { anyRow, showToConfirmList } from "./helpers/recurring";
import { expect, test } from "./fixtures";
import { chooseCsv } from "./helpers/imports";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function row(date: string, label: string, debit: string) {
  return `${date};${label};PRLV ${label};REF1;REF1-;Prelevement;;;${debit};;${date};${date};0`;
}

/** DD/MM/YYYY for the first of the month, `monthsAgo` months before the current one. */
function recentDate(monthsAgo: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `01/${mm}/${d.getUTCFullYear()}`;
}

/** Letters only: the merchant key strips trailing numeric tokens. */
function randomLetters(n: number): string {
  return Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
}

test("price alerts: raised by a higher charge, shown on recurring and dashboard, accepted", async ({ page }) => {
  const label = `E2E-PRICE-${randomLetters(10)}`;
  // Recent months keep the item fresh against the user's latest transaction date.
  // Two imports: the item exists (usual amount 10,00) before the higher charge arrives.
  const stamp = Date.now();
  const csv = (rows: string[]) => Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8");
  const first = {
    name: `price-a-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: csv([
      row(recentDate(3), label, "-10,00"),
      row(recentDate(2), label, "-10,00"),
      row(recentDate(1), label, "-10,00"),
    ]),
  };
  const second = {
    name: `price-b-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: csv([row(recentDate(0), label, "-12,50")]),
  };
  const historyRow = (name: string) =>
    page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: name });
  const result = page.getByRole("region", { name: "Import result" });

  await page.goto("/import");
  await chooseCsv(page, first);
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(result.getByText("3 imported")).toBeVisible();
  await expect(result.getByText(/went up in price/)).toHaveCount(0);

  await page.getByRole("button", { name: "Import another file" }).click();
  await chooseCsv(page, second);
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await expect(result.getByText("1 imported")).toBeVisible();
  await expect(result.getByText("1 recurring payment went up in price")).toBeVisible();
  await expect(result.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/recurring");

  try {
    // Dashboard card: not month-dependent.
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    // A Needs attention row, opening the item's sheet.
    const row = page.getByTestId("attention-price-up").filter({ hasText: label });
    // The old price (struck through) and the new one, side by side.
    await expect(row.locator("s")).toHaveText("€10.00");
    await expect(row).toContainText("€12.50");
    await expect(row).toHaveAttribute("href", /^\/recurring\?item=[0-9a-f-]{36}$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await row.click();
    const sheet = page.getByRole("dialog", { name: label });
    await expect(sheet).toBeVisible();
    const alert = sheet.getByRole("region", { name: "Price increase" });
    await expect(alert).toContainText("Was €10.00, now €12.50");
    await expect(alert).toContainText("+€2.50");
    await expect(alert).toContainText("+25%");
    await expect(sheet.getByRole("list", { name: "Last charges" })).toContainText("new price");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await page.goto("/recurring");
    await showToConfirmList(page);
    const listRow = anyRow(page, label);
    // Old price struck through, new one beside it.
    await expect(listRow.locator("s")).toHaveText("€10.00");
    await expect(listRow).toContainText("12.50");
    // Phone width: no horizontal page scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await listRow.getByRole("button").first().click();
    await sheet.getByRole("button", { name: "Accept new price" }).click();
    await expect(sheet).toBeHidden();
    await expect(listRow).toContainText("12.50");
    await expect(listRow.locator("s")).toHaveCount(0);

    await page.goto("/");
    await expect(page.getByRole("region", { name: "Price increases" }).getByText(label)).toHaveCount(0);
  } finally {
    for (const name of [second.name, first.name]) {
      await page.goto("/import");
      await historyRow(name).getByRole("button", { name: /^Options for / }).click();
      await page.getByRole("menuitem", { name: "Undo import" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
      await expect(page.getByRole("alertdialog")).toBeHidden();
      await expect(historyRow(name)).toHaveCount(0);
    }
  }
});
