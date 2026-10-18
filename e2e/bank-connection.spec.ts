import { expect, test, waitForStreamedContent } from "./fixtures";
import { deleteAccount, deleteAccountsWithPrefix } from "./helpers/manage";
import { undoImport } from "./helpers/recurring";
import { chooseLink, holdFirstSync, disconnectAllBanks, openConnectionMenu } from "./helpers/bank";

// Runs against the fake Enable Banking server that playwright.config.ts starts (e2e/helpers/fake-enable-banking.ts).

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";
const BANK = "Caisse d'Epargne Ile-de-France";

// The fake bank's second account becomes a new franC account; the worker's user expects a single
// account, so the test deletes it, and this hook cleans up after a failure.
const NEW_ACCOUNT = "Livret A";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  await page.goto("/accounts/bank");
  await disconnectAllBanks(page);
  await deleteAccountsWithPrefix(page, NEW_ACCOUNT);
});

async function chooseBank(page: import("@playwright/test").Page) {
  await page.goto("/accounts/bank");
  await expect(page.getByRole("heading", { name: "Link your bank" })).toBeVisible();
  await page.getByRole("button", { name: "Choose my bank", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Your bank" });
  const banks = sheet.getByRole("list", { name: "Banks" }).getByRole("link");
  // Caisse d'Épargne comes first.
  await expect(banks.first()).toHaveText(/^Caisse d'Epargne/);
  await sheet.getByLabel("Search banks").fill("ile-de");
  await expect(banks).toHaveCount(1);
  await banks.first().click();
  await expect(page).toHaveTitle("Fake bank");
}

test("bank connection: connect, link accounts, disconnect keeps the data", async ({ page }) => {
  // An import, the whole connect flow, two link saves and a disconnect: longer than the default.
  test.slow();
  const label = `E2E-BANK-${Date.now()}`;
  const file = `bank-connection-${Date.now()}.csv`;

  // Some history first, to check that disconnecting keeps it. Undone at the end: other specs on
  // this worker's user count months of history (budget presets).
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: file,
    mimeType: "text/csv",
    buffer: Buffer.from(`${HEADER}\n01/09/2025;${label};CB ${label};R1;R1-;Carte;;;-9,99;;01/09/2025;01/09/2025;0\n`, "utf-8"),
  });
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await expect(page.getByRole("region", { name: "Import result" }).getByText("1 imported")).toBeVisible();

  await chooseBank(page);
  await page.getByRole("link", { name: "Approve" }).click();

  // Back in franC: the link step, with the defaults pre-selected.
  await expect(page).toHaveURL(/\/accounts\/bank\?connected=1/);
  // A full page load that didn't go through page.goto, so wait for the streamed content here.
  await waitForStreamedContent(page);
  const card = page.getByTestId("bank-connection");
  await expect(card.getByRole("heading", { name: BANK })).toBeVisible();
  await expect(card.getByText(/^Connected until /)).toBeVisible();
  await expect(card.getByRole("button", { name: /Compte de cheques/ })).toContainText("Main account");
  await expect(card.getByRole("button", { name: /Livret A/ })).toContainText(`New account “${NEW_ACCOUNT}”`);
  await holdFirstSync(page);
  await card.getByRole("button", { name: "Save" }).click();

  const links = card.getByRole("list", { name: "Bank accounts and the franC accounts they feed" });
  await expect(links.getByRole("listitem")).toHaveText([/Main account.*Compte de cheques ••1234/, /Livret A.*Livret A ••5678/]);

  // The accounts page says which accounts are linked.
  await page.goto("/accounts");
  const accounts = page.getByRole("list", { name: "Your accounts" });
  await expect(accounts.getByText(new RegExp(`^${BANK} · `))).toHaveCount(2);

  // Change a link: stop importing the savings account.
  await page.goto("/accounts/bank");
  await openConnectionMenu(card, BANK);
  await page.getByRole("menuitem", { name: "Change links" }).click();
  await chooseLink(card, /Livret A/, "Don't import");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(links.getByRole("listitem").nth(1)).toHaveText(/Not imported.*Livret A ••5678/);

  // Disconnect: the connection goes, the transactions and accounts stay.
  await openConnectionMenu(card, BANK);
  await page.getByRole("menuitem", { name: "Disconnect bank" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Your transactions and accounts stay in franC");
  await dialog.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Link your bank" })).toBeVisible();

  await page.goto(`/transactions?q=${label}`);
  await expect(page.getByRole("button", { name: new RegExp(`^Categorize: ${label}`) })).toBeVisible();
  await page.goto("/accounts");
  await expect(accounts.getByRole("button", { name: `Options for ${NEW_ACCOUNT}`, exact: true })).toBeVisible();
  await expect(accounts.getByText(new RegExp(`^${BANK} · `))).toHaveCount(0);

  await deleteAccount(page, NEW_ACCOUNT);
  await expect(accounts.getByRole("button", { name: `Options for ${NEW_ACCOUNT}`, exact: true })).toBeHidden();
  await undoImport(page, file);
});

test("bank connection: cancelling at the bank shows why and connects nothing", async ({ page }) => {
  await chooseBank(page);
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/accounts\/bank\?error=denied/);
  await waitForStreamedContent(page);
  await expect(page.getByTestId("bank-error")).toHaveText("The bank didn't confirm the connection. Try again.");
  await expect(page.getByRole("heading", { name: "Link your bank" })).toBeVisible();
});
