import { expect, test, waitForStreamedContent } from "./fixtures";
import { isoDaysAgo } from "./helpers/dates";
import { chooseLink, holdFirstSync, disconnectAllBanks, openConnectionMenu } from "./helpers/bank";
import { deleteAccountsWithPrefix, manageSheet, openRowMenu } from "./helpers/manage";

// Slice 48. Runs against the fake Enable Banking server (see docs/testing.md): every sync reads the
// default closing balance, 1234.56 EUR, and the three booked fake rows total 1927.62. The spec never
// changes the fake's balance, so it can't disturb specs running on other workers.
const BANK = "Caisse d'Epargne Ile-de-France";
const ACCOUNT = "Compte de cheques";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await page.goto("/accounts/bank");
  await disconnectAllBanks(page);
  await deleteAccountsWithPrefix(page, ACCOUNT);
});

test("bank balance: read-only after sync, gap on Home with Accept and Undo, editable after disconnect", async ({ page }) => {
  // The connect flow, a sync and about 20 page loads: under four busy workers it outgrows even test.slow().
  test.setTimeout(180_000);

  // 1. Connect and link the checking account to a new franC account.
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
  await chooseLink(card, /Compte de cheques/, `New account “${ACCOUNT}”`);
  await chooseLink(card, /Livret A/, "Don't import");
  await holdFirstSync(page);
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByTestId("sync-status")).toContainText("Not synced yet");

  // 2. Before the first sync the balance is the user's own, with a hint that the bank's replaces it.
  await page.goto("/accounts");
  await openRowMenu(page, ACCOUNT).then((menu) => menu.getByRole("menuitem", { name: "Starting balance" }).click());
  let sheet = manageSheet(page);
  await expect(sheet.getByText("The bank's balance replaces it at the next sync")).toBeVisible();
  await sheet.getByLabel("Balance", { exact: true }).fill("100.00");
  // 100.00 at the start of that day: the bank's change since then (1134.56) will not match the three rows (1927.62).
  await sheet.getByLabel("Date").fill(isoDaysAgo(10));
  await sheet.getByRole("button", { name: "Save balance" }).click();
  await expect(sheet).toBeHidden();

  // 3. Sync now: the balance becomes the bank's, read-only, with where and when it came from.
  await page.goto("/accounts/bank");
  await card.getByRole("button", { name: "Sync now" }).click();
  await expect(card.getByTestId("sync-result")).toContainText("3 new transactions");

  await page.goto("/accounts");
  const row = page.getByRole("list", { name: "Your accounts" }).getByRole("listitem").filter({ hasText: ACCOUNT });
  await expect(row).toContainText("€1,234.56");
  // The menu offers no "Starting balance" for a balance that comes from the bank.
  const menu = await openRowMenu(page, ACCOUNT);
  await expect(menu.getByRole("menuitem", { name: "Starting balance" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click();
  sheet = manageSheet(page);
  await expect(sheet.getByTestId("bank-balance-line")).toHaveText(
    new RegExp(`€1,234\\.56 · From ${BANK}, \\d{1,2} [A-Z][a-z]{2,4} \\d{2}:\\d{2}`),
  );
  await expect(sheet.getByRole("textbox", { name: "Balance", exact: true })).toHaveCount(0);
  await expect(sheet.getByLabel("Date")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Remove starting balance" })).toHaveCount(0);
  await expect(sheet.getByLabel("Warn me below")).toBeVisible();
  await expect(sheet.getByText("Count in safe to spend")).toBeVisible();
  // The same gap block as on Home: the bank shows less than franC adds up to.
  await expect(sheet.getByTestId("account-balance-gap")).toContainText("Your bank shows €793.06 less than franC between");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // 4. This month: the balance card says it comes from the bank. Home: Needs attention shows the gap.
  await page.goto("/budget");
  await expect(page.getByTestId("balance-from-bank")).toContainText(/^From your bank, \d{1,2} [A-Z][a-z]{2,4} \d{2}:\d{2}$/);
  await page.goto("/");
  const gapRow = page.getByTestId("attention-balance-gap");
  await expect(gapRow).toContainText(`${ACCOUNT}: your bank shows €793.06 less than franC between`);

  // 5. The gap sheet offers a CSV import for those dates, or accepting the bank's balance.
  await gapRow.click();
  const gapSheet = page.getByRole("dialog", { name: "Gap with your bank" });
  await expect(gapSheet.getByText("Some of your spending between those dates is probably missing from franC.")).toBeVisible();
  const importLink = gapSheet.getByRole("link", { name: "Import a CSV for those dates" });
  await expect(importLink).toHaveAttribute("href", /^\/import\?account=[0-9a-f-]{36}$/);

  await gapSheet.getByRole("button", { name: "Accept the bank's balance" }).click();
  await expect(gapSheet).toBeHidden();
  const toast = page.getByRole("status").filter({ hasText: "Bank's balance accepted" });
  await expect(toast).toBeVisible();
  await expect(page.getByTestId("attention-balance-gap")).toHaveCount(0);

  // 6. Undo brings the gap back. Accepting is a note: no transaction was added.
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("attention-balance-gap")).toBeVisible();
  await page.goto("/transactions?q=ATELIER+LUMEN");
  await expect(page.getByRole("button", { name: /^Categorize: ATELIER LUMEN/i })).toHaveCount(1);

  // 7. Disconnect: the account keeps the last bank balance, editable again, and the gap check stops.
  await page.goto("/accounts/bank");
  await openConnectionMenu(card, BANK);
  await page.getByRole("menuitem", { name: "Disconnect bank" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("keeps its last bank balance");
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Link your bank" })).toBeVisible();

  await page.goto("/accounts");
  await openRowMenu(page, ACCOUNT).then((m) => m.getByRole("menuitem", { name: "Starting balance" }).click());
  sheet = manageSheet(page);
  await expect(sheet.getByLabel("Balance", { exact: true })).toHaveValue("1234.56");
  await expect(sheet.getByTestId("bank-balance-line")).toHaveCount(0);
  await expect(sheet.getByTestId("account-balance-gap")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.goto("/");
  await expect(page.getByTestId("attention-balance-gap")).toHaveCount(0);

  // 8. Cleanup: delete the new account (its transactions and balances go with it).
  await page.goto("/accounts");
  await deleteAccountsWithPrefix(page, ACCOUNT);
  await expect(page.getByRole("button", { name: `Options for ${ACCOUNT}`, exact: true })).toBeHidden();
});
