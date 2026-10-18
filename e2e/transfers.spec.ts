import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addAccount, deleteAccountsWithPrefix } from "./helpers/manage";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function debitRow(date: string, label: string, debit: string) {
  return `${date};${label};VIR ${label};REF1;;Virement;;;-${debit};;${date};${date};0`;
}

function creditRow(date: string, label: string, credit: string) {
  return `${date};${label};VIR ${label};REF2;;Virement recu;;;;+${credit};${date};${date};0`;
}

// The worker's E2E user is shared by the specs it runs, which assume a single account: every account
// this spec creates is prefixed so it can be removed even after a failure (its
// transfer pairs go with it).
const PREFIX = "E2E Joint";
// A month no other spec imports into, so the dashboard counts only this spec's transfers.
const MONTH = "2024-02";

test.afterEach(async ({ page }) => {
  await deleteAccountsWithPrefix(page, PREFIX);
});

async function importInto(page: Page, account: string, fileName: string, rows: string[]) {
  await page.goto("/import");
  await page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name: account }).click();
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: `Import ${rows.length} transactions` }).click();
  return page.getByRole("region", { name: "Import result" });
}

async function undoImport(page: Page, fileName: string) {
  await page.goto("/import");
  const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: fileName });
  await row.getByRole("button", { name: /^Options for / }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row).toHaveCount(0);
}

function rowButton(page: Page, label: string) {
  return page.getByRole("button", { name: new RegExp(`^Categorize: ${label} `) });
}

test("transfers: detected after the second import, filtered, linked by hand, unlinked", async ({ page }) => {
  const stamp = Date.now();
  const joint = `${PREFIX} ${stamp}`;
  const label = `E2E-TRF-${stamp}`;
  // Amounts unique to this run, so leftovers from earlier runs never pair with them.
  const euros = 100 + (stamp % 800);
  const auto = `${euros},${String(stamp % 100).padStart(2, "0")}`;
  const hand = `${euros + 1000},${String(stamp % 100).padStart(2, "0")}`;
  const mainFile = `transfers-main-${stamp}.csv`;

  await addAccount(page, joint);

  try {
    // The first account alone has nothing to pair with.
    const first = await importInto(page, "Main account", mainFile, [
      debitRow("05/02/2024", `${label}-OUT`, auto),
      debitRow("10/02/2024", `${label}-HOUT`, hand),
    ]);
    await expect(first.getByText("2 imported")).toBeVisible();
    await expect(first.getByText(/internal transfers? found/)).toBeHidden();

    // The second account arrives later: the same-amount pair 2 days apart is detected;
    // the other one is 6 days apart, outside the automatic window.
    const second = await importInto(page, joint, `transfers-joint-${stamp}.csv`, [
      creditRow("07/02/2024", `${label}-IN`, auto),
      creditRow("16/02/2024", `${label}-HIN`, hand),
    ]);
    await expect(second.getByText("1 internal transfer found")).toBeVisible();

    await page.goto(`/transactions?q=${label}`);
    const outMarker = rowButton(page, `${label}-OUT`).getByTestId("transfer-marker");
    await expect(outMarker).toHaveAttribute("data-status", "detected");
    await expect(outMarker).toContainText(`Internal transfer · ${joint}`);
    await expect(rowButton(page, `${label}-HOUT`).getByTestId("transfer-marker")).toHaveCount(0);

    // Hiding transfers leaves only the unpaired rows.
    await page.goto(`/transactions?q=${label}&transfers=hide`);
    await expect(page.getByRole("link", { name: "Remove filter: Hide internal transfers" })).toBeVisible();
    await expect(rowButton(page, `${label}-HOUT`)).toBeVisible();
    await expect(rowButton(page, `${label}-OUT`)).toBeHidden();

    await page.goto(`/budget?month=${MONTH}`);
    await expect(page.getByRole("link", { name: "1 internal transfer not counted" })).toBeVisible();

    // Link the delayed pair by hand.
    await page.goto(`/transactions?q=${label}`);
    await rowButton(page, `${label}-HOUT`).click();
    await sheetOf(page).getByTestId("sheet-transfer").click();
    const section = sheetOf(page).getByTestId("transfer-section");
    await section.getByRole("button", { name: "Mark as internal transfer" }).click();
    await section
      .getByRole("list", { name: "Matching transactions" })
      .getByRole("button", { name: `Link ${label}-HIN` })
      .click();
    // Linking returns to the main view with a toast; the transfer row says where it is linked.
    await expect(toastWith(page, "Marked as internal transfer")).toBeVisible();
    await expect(sheetOf(page).getByTestId("sheet-transfer")).toContainText(`Linked to ${joint}`);
    await closeSheet(page);
    await expect(rowButton(page, `${label}-HOUT`).getByTestId("transfer-marker")).toHaveAttribute(
      "data-status",
      "confirmed",
    );

    await page.goto(`/budget?month=${MONTH}`);
    await expect(page.getByRole("link", { name: "2 internal transfers not counted" })).toBeVisible();

    // Unlink the detected pair: it counts again and isn't re-detected on the next import.
    await page.goto(`/transactions?q=${label}`);
    await rowButton(page, `${label}-OUT`).click();
    await sheetOf(page).getByTestId("sheet-transfer").click();
    await sheetOf(page).getByTestId("transfer-section").getByRole("button", { name: "Unlink" }).click();
    await expect(toastWith(page, "Transfer unlinked")).toBeVisible();
    await expect(sheetOf(page).getByTestId("sheet-transfer")).not.toContainText("Linked to");
    await closeSheet(page);
    await expect(rowButton(page, `${label}-OUT`).getByTestId("transfer-marker")).toHaveCount(0);

    await page.goto(`/budget?month=${MONTH}`);
    await expect(page.getByRole("link", { name: "1 internal transfer not counted" })).toBeVisible();
  } finally {
    // The joint account is deleted in afterEach; the main account's rows go with their import.
    await undoImport(page, mainFile);
  }
});
