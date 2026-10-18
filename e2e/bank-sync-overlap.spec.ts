import { type Page } from "@playwright/test";

import { expect, test, waitForStreamedContent } from "./fixtures";
import { isoDaysAgo } from "./helpers/dates";
import { chooseLink, holdFirstSync, disconnectAllBanks } from "./helpers/bank";
import { deleteAccount, deleteAccountsWithPrefix } from "./helpers/manage";
import { settled } from "./helpers/recurring";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";

// Slice 47: a CSV import and the bank sync feed the same account without counting a purchase twice.
// The fake bank (e2e/helpers/fake-transactions.ts) serves fixed rows dated relative to today:
//   bakery 5,88 on today-3 (operation date), Orange 66,50 on today-5, a 2000,00 credit on today-6.

const BANK = "Caisse d'Epargne Ile-de-France";
// Not "Main account": other specs on this worker count its history, and a sync run has no Undo.
const NEW_ACCOUNT = "Compte de cheques";
const FILE = `overlap-${Date.now()}.csv`;

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function frDaysAgo(days: number): string {
  const iso = isoDaysAgo(days);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function csvRow(daysAgo: number, label: string, debit: string, credit: string): string {
  const date = frDaysAgo(daysAgo);
  return `${date};${label};PRLV ${label};REF;REF-;Prelevement;;;${debit};${credit};${date};${date};0`;
}

function buildCsv(): Buffer {
  const lines = [
    HEADER,
    // Same purchase as the bank's bakery row, written with another label: one candidate, same day.
    csvRow(3, "BOULANGERIE DES LILAS", "-5,88", ""),
    // Two Orange debits near the bank's (today-5), neither on its day: a possible duplicate.
    csvRow(4, "ORANGE FACTURE", "-66,50", ""),
    csvRow(6, "ORANGE FACTURE", "-66,50", ""),
    // Two credits near the bank's (today-6), neither on its day.
    csvRow(5, "SALAIRE E2E", "", "2000,00"),
    csvRow(7, "SALAIRE E2E", "", "2000,00"),
  ];
  return Buffer.from(lines.join("\n") + "\n", "utf-8");
}

const csvFile = () => ({ name: FILE, mimeType: "text/csv", buffer: buildCsv() });

async function undoImport(page: Page) {
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
  const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: FILE });
  if ((await row.count()) === 0) return;
  await row.getByRole("button", { name: /^Options for / }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
}

async function disconnectAll(page: Page) {
  await page.goto("/accounts/bank");
  await disconnectAllBanks(page);
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await disconnectAll(page);
  await deleteAccountsWithPrefix(page, NEW_ACCOUNT);
});

function rowsMatching(page: Page, text: string) {
  return page.getByRole("list", { name: "Transactions" }).getByRole("button", { name: new RegExp(`^Categorize: .*${text}`, "i") });
}

test("manual and automatic together: matches, possible duplicates, ignore, origin", async ({ page }) => {
  test.slow();

  // 1. Connect through the fake bank, feeding a new account.
  await page.goto("/accounts/bank");
  await page.getByRole("button", { name: "Choose my bank", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Your bank" });
  await picker.getByLabel("Search banks").fill("ile-de");
  await picker.getByRole("list", { name: "Banks" }).getByRole("link").first().click();
  await expect(page).toHaveTitle("Fake bank");
  await page.getByRole("link", { name: "Approve" }).click();
  await expect(page).toHaveURL(/\/accounts\/bank\?connected=1/);
  await waitForStreamedContent(page);

  const card = page.getByTestId("bank-connection");
  await expect(card.getByRole("heading", { name: BANK })).toBeVisible();
  await chooseLink(card, /Compte de cheques/, `New account “${NEW_ACCOUNT}”`);
  await chooseLink(card, /Livret A/, "Don't import");
  await holdFirstSync(page);
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByTestId("sync-status")).toContainText("Not synced yet");

  // 2. Import the CSV into that account first: the connected account says it syncs on its own.
  await page.goto("/import");
  await page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name: NEW_ACCOUNT }).click();
  await expect(page.getByTestId("import-sync")).toContainText("This account syncs automatically. Import a CSV for older history or a gap.");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles(csvFile());
  await page.getByRole("button", { name: "Import 5 transactions" }).click();
  await expect(page.getByRole("region", { name: "Import result" }).getByText("5 imported")).toBeVisible();

  // 3. Sync now: the bakery merges into its CSV twin; Orange and the credit come in as possible duplicates.
  await page.goto("/accounts/bank");
  await card.getByRole("button", { name: "Sync now" }).click();
  await expect(card.getByTestId("sync-result")).toContainText("2 new transactions");

  await page.goto("/transactions?q=BOULANGERIE");
  await expect(rowsMatching(page, "BOULANGERIE")).toHaveCount(1);
  await page.goto("/transactions?q=ORANGE");
  await expect(rowsMatching(page, "ORANGE")).toHaveCount(3);

  // 4. Review: Orange is the same transaction as one of the CSV rows (desktop layout: grouped list + card).
  await page.goto("/review");
  await page.getByRole("button", { name: /^Review ORANGE BOX/i }).click();
  const dupes = page.getByTestId("possible-duplicates");
  await expect(dupes).toBeVisible();
  await expect(dupes.getByTestId("possible-duplicate-candidate")).toHaveCount(2);
  // The review queue saves behind an optimistic toast: wait for the server before navigating.
  await settled(page, () => dupes.getByRole("button", { name: /^Same transaction as ORANGE FACTURE/ }).first().click());
  await expect(toastWith(page, "Merged with the existing transaction")).toBeVisible();

  await page.goto("/transactions?q=ORANGE");
  await expect(rowsMatching(page, "ORANGE")).toHaveCount(2);

  // The credit stays: Keep both.
  await page.goto("/review");
  await page.getByRole("button", { name: /^Review ATELIER LUMEN/i }).click();
  await expect(page.getByTestId("possible-duplicates")).toBeVisible();
  await settled(page, () => page.getByTestId("possible-duplicates").getByRole("button", { name: "Keep both" }).click());
  await expect(toastWith(page, "Kept both")).toBeVisible();
  await expect(page.getByTestId("possible-duplicate-badge")).toHaveCount(0);

  await page.goto("/transactions?q=ATELIER+LUMEN");
  await expect(rowsMatching(page, "ATELIER LUMEN")).toHaveCount(1);
  await page.goto("/transactions?q=SALAIRE");
  await expect(rowsMatching(page, "SALAIRE")).toHaveCount(2);

  // 5. Origin line on the sheet.
  await page.goto("/transactions?q=ATELIER+LUMEN");
  await rowsMatching(page, "ATELIER LUMEN").first().click();
  await expect(sheetOf(page).getByTestId("sheet-origin")).toContainText("From your bank");
  await closeSheet(page);
  await page.goto("/transactions?q=SALAIRE");
  await rowsMatching(page, "SALAIRE").first().click();
  await expect(sheetOf(page).getByTestId("sheet-origin")).toContainText("From CSV, ");
  await closeSheet(page);

  // 6. Re-importing the same file finds everything already there.
  await page.goto("/import");
  await page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name: NEW_ACCOUNT }).click();
  await expect(page.getByTestId("import-sync")).toContainText("This account syncs automatically");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles(csvFile());
  await expect(page.getByRole("region", { name: "Import preview" }).getByText("All 5 transactions in this file are already in franC.")).toBeVisible();

  // 7. Ignore a row from its sheet: it leaves the list, and comes back under the Show filter.
  await page.goto("/transactions?q=SALAIRE");
  await rowsMatching(page, "SALAIRE").first().click();
  await sheetOf(page).getByTestId("sheet-ignore").click();
  await expect(toastWith(page, "Ignored").first()).toBeVisible();
  await expect(sheetOf(page)).toBeHidden();
  await expect(rowsMatching(page, "SALAIRE")).toHaveCount(1);
  await page.goto("/transactions?q=SALAIRE&ignored=show");
  await expect(rowsMatching(page, "SALAIRE")).toHaveCount(2);
  await expect(page.getByTestId("row-ignored")).toHaveCount(1);

  // 8. Cleanup: disconnect, undo the import, delete the account.
  await disconnectAll(page);
  await undoImport(page);
  await page.goto("/accounts");
  await deleteAccount(page, NEW_ACCOUNT);
  await expect(page.getByRole("button", { name: `Options for ${NEW_ACCOUNT}`, exact: true })).toBeHidden();
});
