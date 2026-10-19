import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addAccount, deleteAccount, deleteAccountsWithPrefix, manageSheet, openRowMenu, rowMenuAction } from "./helpers/manage";
import { chooseCsv } from "./helpers/imports";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function debitRow(date: string, label: string, debit: string) {
  return `${date};${label};PRLV ${label};REF1;REF1-;Prelevement;;;${debit};;${date};${date};0`;
}

// The worker's E2E user is shared by the specs it runs, which assume a single account: every account
// this spec creates is prefixed so it can be removed even after a failure.
const PREFIX = "E2E Joint";

test.afterEach(async ({ page }) => {
  await deleteAccountsWithPrefix(page, PREFIX);
});

test("accounts: create, rename, import into a second account, filter, delete", async ({ page }) => {
  const stamp = Date.now();
  const name = `${PREFIX} ${stamp}`;
  const renamed = `${PREFIX} ${stamp} renamed`;
  const label = `E2E-ACC-${stamp}`;
  const list = page.getByRole("list", { name: "Your accounts" });

  // Create, with a case-insensitive duplicate check.
  await page.goto("/settings");
  await page.getByRole("link", { name: /Accounts/ }).click();
  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  await addAccount(page, name.toUpperCase());
  await page.getByRole("link", { name: "New account", exact: true }).click();
  const sheet = manageSheet(page);
  await sheet.getByLabel("Account name").fill(name);
  await sheet.getByRole("button", { name: "Add account" }).click();
  await expect(sheet.getByRole("alert").filter({ hasText: "An account with this name already exists" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Rename, from the row's menu.
  await rowMenuAction(page, name.toUpperCase(), "Edit");
  await sheet.getByLabel("Account name").fill(renamed);
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(list.getByRole("button", { name: `Options for ${renamed}`, exact: true })).toBeVisible();

  // Import into the new account.
  await page.goto("/import");
  await page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name: renamed }).click();
  await chooseCsv(page, {
    name: `accounts-${stamp}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(
      [HEADER, debitRow("01/09/2025", label, "-12,50"), debitRow("02/09/2025", `${label}-B`, "-3,20")].join("\n") + "\n",
      "utf-8",
    ),
  });
  const preview = page.getByRole("region", { name: "Import preview" });
  await expect(preview.getByText(renamed)).toBeVisible();
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByRole("region", { name: "Import result" }).getByText("2 imported")).toBeVisible();

  // The import page remembers the last account used.
  await page.goto("/import");
  await expect(page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name: renamed })).toHaveAttribute("aria-checked", "true");

  // Transactions: filtered by account, each row shows its account.
  const id = await accountId(page, renamed);
  await page.goto(`/transactions?q=${label}&account=${id}`);
    await expect(page.getByRole("button", { name: new RegExp(`^Categorize: ${label}-B.*${renamed}`) })).toBeVisible();
  await page.getByTestId("filters-button").click();
  const filters = page.getByRole("dialog", { name: "Filters" });
  await expect(filters.getByLabel("Account", { exact: true })).toHaveValue(id);
  await filters.getByLabel("Account", { exact: true }).selectOption({ label: "Main account" });
  await filters.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/account=/);
  await expect(page.getByText(`${label}-B`)).toBeHidden();

  // Delete: the confirmation says what goes, then the account and its rows are gone.
  await page.goto("/accounts");
  await rowMenuAction(page, renamed, "Delete");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(`This deletes ${renamed}, its 1 import and 2 transactions.`);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  await expect(dialog).toBeHidden();
  await expect(list.getByRole("button", { name: `Options for ${renamed}`, exact: true })).toBeHidden();
  await page.goto(`/transactions?q=${label}`);
  await expect(page.getByText(`${label}-B`)).toBeHidden();
});

test("accounts: the menu opens the account sheet, the balance part, and the transactions", async ({ page }) => {
  const name = `${PREFIX} ${Date.now()} menu`;
  await addAccount(page, name);
  const list = page.getByRole("list", { name: "Your accounts" });
  const row = list.getByRole("listitem").filter({ hasText: name });
  await expect(row).toContainText("CSV · never imported");

  // Tapping the row and "Edit" open the same sheet: rename, balance, switches.
  await row.getByRole("button").first().click();
  const sheet = manageSheet(page);
  await expect(sheet).toHaveAccessibleName(name);
  await expect(sheet.getByLabel("Account name")).toHaveValue(name);
  await expect(sheet.getByLabel("Count in safe to spend")).toBeVisible();
  await expect(sheet.getByLabel("Remind me to import")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // "Starting balance" opens it with the amount field focused.
  await rowMenuAction(page, name, "Starting balance");
  await expect(sheet.getByLabel("Balance", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // "See transactions" links to the transactions list filtered by this account.
  const menu = await openRowMenu(page, name);
  await expect(menu.getByRole("menuitem", { name: "See transactions" })).toHaveAttribute("href", /\/transactions\?account=[0-9a-f-]{36}$/);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await deleteAccount(page, name);
});

test("accounts: the only account can't be deleted", async ({ page }) => {
  await page.goto("/accounts");
  const list = page.getByRole("list", { name: "Your accounts" });
  const menu = await openRowMenu(page, await onlyAccountName(page));
  await expect(menu.getByRole("menuitem", { name: /^Delete/ })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Delete (your only account)" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  // The account sheet says why.
  await list.getByRole("listitem").first().getByRole("button").first().click();
  await expect(manageSheet(page).getByText("You can't delete your only account. Add another one first.")).toBeVisible();
});

async function onlyAccountName(page: Page): Promise<string> {
  const label = await page.getByRole("button", { name: /^Options for / }).first().getAttribute("aria-label");
  return (label ?? "").replace(/^Options for /, "");
}

/** Reads an account's id from the Account filter on the transactions page. */
async function accountId(page: Page, name: string): Promise<string> {
  await page.goto("/transactions");
  await page.getByTestId("filters-button").click();
  const value = await page
    .getByLabel("Account", { exact: true })
    .locator("option", { hasText: name })
    .getAttribute("value");
  if (!value) throw new Error("account option not found");
  await page.keyboard.press("Escape");
  return value;
}
