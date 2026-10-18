import { expect, test, waitForStreamedContent } from "./fixtures";
import { isoDaysAgo } from "./helpers/dates";
import { chooseLink, holdFirstSync, disconnectAllBanks, openConnectionMenu } from "./helpers/bank";
import { deleteAccount, deleteAccountsWithPrefix } from "./helpers/manage";

// Runs against the fake Enable Banking server that playwright.config.ts starts
// (e2e/helpers/fake-enable-banking.ts, rows in e2e/helpers/fake-transactions.ts).

const BANK = "Caisse d'Epargne Ile-de-France";
// The franC account created for the checking account. Synced rows must not land in "Main account":
// other specs on this worker count its history, and a sync run has no Undo.
const NEW_ACCOUNT = "Compte de cheques";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await page.goto("/accounts/bank");
  await disconnectAllBanks(page);
  await deleteAccountsWithPrefix(page, NEW_ACCOUNT);
});


test("bank sync: link to a new account, sync now, review the rows, sync again", async ({ page }) => {
  // The connect flow, two syncs and several page loads: longer than the default.
  test.slow();

  // 1. Connect through the fake bank.
  await page.goto("/accounts/bank");
  await page.getByRole("button", { name: "Choose my bank", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Your bank" });
  await sheet.getByLabel("Search banks").fill("ile-de");
  await sheet.getByRole("list", { name: "Banks" }).getByRole("link").first().click();
  await expect(page).toHaveTitle("Fake bank");
  await page.getByRole("link", { name: "Approve" }).click();
  await expect(page).toHaveURL(/\/accounts\/bank\?connected=1/);
  await waitForStreamedContent(page);

  const card = page.getByTestId("bank-connection");
  await expect(card.getByRole("heading", { name: BANK })).toBeVisible();
  await chooseLink(card, /Compte de cheques/, `New account “${NEW_ACCOUNT}”`);
  await chooseLink(card, /Livret A/, "Don't import");

  // The start date field shows while a choice imports and the link hasn't synced yet.
  const from = card.getByLabel("Bring transactions from");
  await expect(from).toHaveCount(1);
  await expect(from).toHaveValue(isoDaysAgo(89));
  await holdFirstSync(page);
  await card.getByRole("button", { name: "Save" }).click();

  // 2. Not synced yet, then Sync now.
  const links = card.getByRole("list", { name: "Bank accounts and the franC accounts they feed" });
  const status = links.getByTestId("sync-status");
  await expect(status).toHaveCount(1);
  await expect(status).toContainText("Not synced yet · from ");

  const result = card.getByTestId("sync-result");
  await card.getByRole("button", { name: "Sync now" }).click();
  await expect(result).toContainText("3 new transactions");
  await expect(result.getByRole("link", { name: "Review now" })).toBeVisible();
  await expect(status).toContainText(/Synced .* · 3 new/);

  // 3. The three rows carry short labels; the pending one is never imported.
  for (const label of ["BOULANGERIE DES L", "ORANGE BOX", "ATELIER LUMEN"]) {
    await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
    await expect(page.getByRole("button", { name: new RegExp(`^Categorize: ${label}`, "i") })).toBeVisible();
  }
  await page.goto("/transactions?q=SUPER+U");
  await expect(page.getByRole("button", { name: /^Categorize: SUPER U/i })).toHaveCount(0);
  await page.goto("/review");
  await expect(page.getByText("SUPER U")).toHaveCount(0);

  // 4. A second sync finds nothing new.
  await page.goto("/accounts/bank");
  await card.getByRole("button", { name: "Sync now" }).click();
  await expect(result).toContainText("Nothing new");

  // 5. The import page offers the same sync for the linked account, and history has no Undo.
  await page.goto("/import");
  await page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name: NEW_ACCOUNT }).click();
  const section = page.getByTestId("import-sync");
  await expect(section.getByRole("heading", { name: `Connected to ${BANK}` })).toBeVisible();
  await section.getByRole("button", { name: "Sync now" }).click();
  await expect(section.getByTestId("sync-result")).toContainText("Nothing new");
  const runs = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: `Synced from ${BANK}` });
  await expect(runs.first()).toBeVisible();
  await expect(runs.getByRole("button", { name: /^Options for / })).toHaveCount(0);

  // 6. Cleanup: disconnect, then delete the new account (its transactions and imports go with it).
  await page.goto("/accounts/bank");
  await openConnectionMenu(card, BANK);
  await page.getByRole("menuitem", { name: "Disconnect bank" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Link your bank" })).toBeVisible();
  await page.goto("/accounts");
  await deleteAccount(page, NEW_ACCOUNT);
  await expect(page.getByRole("button", { name: `Options for ${NEW_ACCOUNT}`, exact: true })).toBeHidden();
});
