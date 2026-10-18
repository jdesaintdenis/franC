import { expect, type Locator, type Page } from "@playwright/test";

export const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

/** A direct-debit row with an empty bank category (see slice 40: "Create" is preselected). */
export function debitRow(date: string, label: string, debit: string): string {
  return `${date};${label};PRLV ${label};REF1;REF1-;Prelevement;;;${debit};;${date};${date};0`;
}

/** A salary-style credit row (Credit column) with an empty bank category. */
export function creditRow(date: string, label: string, credit: string): string {
  return `${date};${label};VIR ${label};REF1;REF1-;Virement recu;;;;${credit};${date};${date};0`;
}

/** DD/MM/YYYY for the given day of the month, `monthsAgo` months before the current one. */
export function recentDate(monthsAgo: number, day = 1): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day));
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

export function csvFile(name: string, rows: string[]) {
  return { name, mimeType: "text/csv", buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8") };
}

/** The row of a running item in Bills and subscriptions (or Income). */
export function billRow(page: Page, text: string, list = "Bills and subscriptions"): Locator {
  return page.getByRole("list", { name: list, exact: true }).getByRole("listitem").filter({ hasText: text });
}

/** The open item sheet, named by the item. */
export function itemSheet(page: Page, name: string | RegExp): Locator {
  return page.getByRole("dialog", { name });
}

/** Touch-style horizontal drag through pointer events (Playwright has no swipe API). */
export async function swipe(target: Locator, dx: number): Promise<void> {
  await target.evaluate(async (el, distance) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - distance / 2;
    const y = rect.top + rect.height / 2;
    const fire = (type: string, clientX: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: "touch", isPrimary: true, clientX, clientY: y }),
      );
    fire("pointerdown", x);
    for (const step of [0.25, 0.5, 0.75, 1]) fire("pointermove", x + distance * step);
    fire("pointerup", x + distance);
  }, dx);
}

/** Undoes an import from the import history so reruns stay deterministic. */
export async function undoImport(page: Page, fileName: string): Promise<void> {
  const historyRow = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: fileName });
  await page.goto("/import");
  await historyRow.getByRole("button", { name: /^Options for / }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(historyRow).toHaveCount(0);
}

export async function importFile(page: Page, file: ReturnType<typeof csvFile>, count: number): Promise<void> {
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles(file);
  await page.getByRole("button", { name: count === 1 ? "Import 1 transaction" : `Import ${count} transactions` }).click();
  await expect(page.getByRole("region", { name: "Import result" }).getByText(`${count} imported`)).toBeVisible();
}

/** An action button of the open item sheet (the sheet's toast has its own Dismiss button). */
export function sheetAction(page: Page, name: string, action: string): Locator {
  return itemSheet(page, name).getByRole("group", { name: "Actions" }).getByRole("button", { name: action, exact: true });
}

/**
 * Runs `act` and waits for the server action it posts. The list updates optimistically, so
 * without this a reload or navigation right after can render before the server has the change.
 */
export async function settled(page: Page, act: () => Promise<void>): Promise<void> {
  const response = page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined);
  await act();
  await response;
}

/** Switches "À confirmer" to its list and expands it, so a given item can be found among the others. */
export async function showToConfirmList(page: Page): Promise<void> {
  const block = page.getByTestId("to-confirm");
  const toggle = block.getByRole("button", { name: "See the list" });
  if (await toggle.count()) await toggle.click();
  const more = block.getByRole("button", { name: /^See the \d+ others$/ });
  if (await more.count()) await more.click();
}

/** The row of a detected item in the "To confirm" list (call `showToConfirmList` first). */
export function toConfirmRow(page: Page, text: string): Locator {
  return page.getByRole("list", { name: "Payments to confirm", exact: true }).getByRole("listitem").filter({ hasText: text });
}

/** The row of an item whether it waits in "To confirm" or is already confirmed (call `showToConfirmList` first). */
export function anyRow(page: Page, text: string): Locator {
  return page
    .locator('ul[aria-label="Bills and subscriptions"], ul[aria-label="Payments to confirm"], ul[aria-label="Income"]')
    .getByRole("listitem")
    .filter({ hasText: text });
}
