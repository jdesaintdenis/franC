import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addAccount, deleteAccountsWithPrefix, manageSheet, rowMenuAction, setStartingBalance } from "./helpers/manage";
import { closeSheet, sheetOf, toastWith } from "./helpers/sheet";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function debitRow(date: string, label: string, debit: string) {
  return `${date};${label};VIR ${label};REF1;;Virement;;;-${debit};;${date};${date};0`;
}

// Accounts this spec creates are prefixed so afterEach can remove them even after a failure.
const PREFIX = "E2E Savings";
// A month no other spec imports into.
const MONTH = "2024-03";

test.afterEach(async ({ page }) => {
  await deleteAccountsWithPrefix(page, PREFIX);
});

async function importMain(page: Page, fileName: string, rows: string[]) {
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: `Import ${rows.length} transactions` }).click();
  await expect(page.getByRole("region", { name: "Import result" }).getByText(`${rows.length} imported`)).toBeVisible();
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

async function moveRow(page: Page, label: string, account: string, withRule: boolean) {
  await page.goto(`/transactions?q=${label}`);
  await rowButton(page, label).first().click();
  await sheetOf(page).getByTestId("sheet-savings").click();
  const step = sheetOf(page).getByTestId("savings-step");
  if (withRule) await step.getByRole("checkbox").check();
  await step.getByRole("button", { name: account, exact: true }).click();
}

test("savings: account type, move to savings with a rule, undo, This month and Year", async ({ page }) => {
  test.slow();
  const stamp = Date.now();
  const savings = `${PREFIX} ${stamp}`;
  const label = `E2E-SAV-${stamp}`;
  const file = `savings-main-${stamp}.csv`;
  const spentLine = page.getByTestId("month-spent");
  const savedLine = page.getByTestId("saved-in");

  await addAccount(page, savings);

  try {
    await importMain(page, file, [
      debitRow("05/03/2024", label, "120,00"),
      debitRow("12/03/2024", label, "120,00"),
      debitRow("15/03/2024", `E2E-OTHER-${stamp}`, "50,00"),
    ]);

    // Without a Savings account there is no Saved total.
    await page.goto(`/budget?month=${MONTH}`);
    await expect(spentLine).toBeVisible();
    await expect(savedLine).toHaveCount(0);

    // Switch the new account to Savings.
    await page.goto("/accounts");
    await rowMenuAction(page, savings, "Edit");
    const sheet = manageSheet(page);
    await sheet.getByLabel("Savings account").check();
    await expect(toastWith(page, "Now a savings account")).toBeVisible();
    await expect(sheet.getByLabel("Count in safe to spend")).not.toBeChecked();
    await expect(sheet.getByLabel("Remind me to import")).toHaveCount(0);

    // Imports can't target it.
    await page.goto("/import");
    await expect(page.getByLabel("Account", { exact: true }).locator("option", { hasText: savings })).toHaveCount(0);

    // Saved shows up, still zero.
    await page.goto(`/budget?month=${MONTH}`);
    await expect(savedLine).toContainText("€0.00");
    await expect(spentLine).toContainText("€290");

    // Move one payment, no rule.
    await moveRow(page, label, savings, false);
    await expect(toastWith(page, `Moved to ${savings}`)).toBeVisible();
    await closeSheet(page);
    await page.goto(`/budget?month=${MONTH}`);
    await expect(savedLine).toContainText("€120.00");
    await expect(spentLine).toContainText("€170"); // 290 - 120

    // Undo from the sheet removes the created row.
    await page.goto(`/transactions?q=${label}`);
    await rowButton(page, label).first().click();
    await sheetOf(page).getByTestId("sheet-transfer").click();
    await sheetOf(page).getByTestId("transfer-section").getByRole("button", { name: /Undo|Remove/ }).click();
    await expect(toastWith(page, "Move undone")).toBeVisible();
    await closeSheet(page);
    await page.goto(`/budget?month=${MONTH}`);
    await expect(spentLine).toContainText("€290");

    // Move with a rule: the other matching payment goes too.
    await moveRow(page, label, savings, true);
    await expect(toastWith(page, `Moved to ${savings}`)).toBeVisible();
    await expect(toastWith(page, /1 earlier one and future ones too/)).toBeVisible();
    await closeSheet(page);
    await page.goto(`/budget?month=${MONTH}`);
    await expect(savedLine).toContainText("€240.00"); // both moved
    await expect(spentLine).toContainText("€50");

    // The rule is listed on the account and can be removed, then restored.
    await page.goto("/accounts");
    await rowMenuAction(page, savings, "Edit");
    const rules = manageSheet(page).getByTestId("savings-rules");
    await expect(rules).toContainText("Label contains");
    await rules.getByRole("button", { name: /^Remove the rule for/ }).click();
    await expect(toastWith(page, "Rule removed")).toBeVisible();
    await expect(rules).toContainText("None yet");
    await toastWith(page, "Rule removed").getByRole("button", { name: "Undo" }).click();
    await expect(rules).toContainText("Label contains");

    // Year: a month row says how much was set aside.
    await page.goto("/year?year=2024");
    await expect(page.getByTestId("year-months").getByText(/set aside/).first()).toBeVisible();
  } finally {
    await undoImport(page, file);
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`savings: This month totals fit a phone (${colorScheme})`, async ({ page }) => {
    test.slow();
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 375, height: 812 });
    const stamp = Date.now();
    const name = `${PREFIX} ${stamp}`;
    const file = `savings-phone-${colorScheme}-${stamp}.csv`;
    await addAccount(page, name);
    await page.goto("/accounts");
    await rowMenuAction(page, name, "Edit");
    await manageSheet(page).getByLabel("Savings account").check();
    await expect(toastWith(page, "Now a savings account")).toBeVisible();

    try {
      // Home shows nothing for a month without transactions.
      await importMain(page, file, [
        debitRow("20/03/2024", `E2E-PHONE-${stamp}`, "30,00"),
        debitRow("21/03/2024", `E2E-PHONE-${stamp}`, "31,00"),
      ]);
      await page.goto(`/budget?month=${MONTH}`);
      await expect(page.getByTestId("saved-in")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await undoImport(page, file);
    }
  });
}

test("savings: move to a goal, change its goal, and see what the goal holds", async ({ page }) => {
  test.slow();
  const stamp = Date.now();
  const savings = `${PREFIX} ${stamp}`;
  const goal = `E2E Goal ${stamp} car`;
  const label = `E2E-GOAL-${stamp}`;
  const file = `savings-goal-${stamp}.csv`;

  await addAccount(page, savings);
  await rowMenuAction(page, savings, "Edit");
  await manageSheet(page).getByLabel("Savings account").check();
  await expect(toastWith(page, "Now a savings account")).toBeVisible();
  await setStartingBalance(page, savings, "1000,00");

  // A goal kept in the Savings account.
  await page.goto("/settings/goals?add=1");
  const form = manageSheet(page);
  await form.getByLabel("Name", { exact: true }).fill(goal);
  await form.getByLabel("Target", { exact: true }).fill("3000");
  await form.getByRole("radio", { name: "On an account" }).click();
  await form.getByRole("radio", { name: savings, exact: true }).click();
  await form.getByRole("button", { name: "Add goal" }).click();
  await expect(form).toBeHidden();

  try {
    // Two rows: the import button reads "Import 2 transactions".
    await importMain(page, file, [debitRow("05/03/2024", label, "120,00"), debitRow("06/03/2024", `E2E-OTHER-${stamp}`, "10,00")]);

    // Move step: one tap on the goal moves the money and tags it.
    await page.goto(`/transactions?q=${label}`);
    await rowButton(page, label).first().click();
    await sheetOf(page).getByTestId("sheet-savings").click();
    const step = sheetOf(page).getByTestId("savings-step");
    await expect(step.getByRole("button", { name: `${savings} · not assigned` })).toBeVisible();
    await step.getByTestId("savings-goal-button").filter({ hasText: goal }).click();
    await expect(toastWith(page, `Moved to ${goal} in ${savings}`)).toBeVisible();

    // The transfer section names the goal; changing it to none leaves the goal empty.
    await sheetOf(page).getByTestId("sheet-transfer").click();
    const moveGoal = sheetOf(page).getByTestId("move-goal");
    await expect(moveGoal).toContainText(`Goal: ${goal}`);
    await moveGoal.getByRole("button", { name: "Change" }).click();
    await moveGoal.getByLabel("Goal", { exact: true }).selectOption({ label: "Not assigned to a goal" });
    await moveGoal.getByRole("button", { name: "Save" }).click();
    await expect(moveGoal).toContainText("Not assigned to a goal");
    await expect(moveGoal.getByRole("status")).toHaveText("Goal updated");
    await moveGoal.getByRole("button", { name: "Change" }).click();
    await moveGoal.getByLabel("Goal", { exact: true }).selectOption({ label: `${goal} · €0.00` });
    await moveGoal.getByRole("button", { name: "Save" }).click();
    await expect(moveGoal).toContainText(`Goal: ${goal}`);
    // Escape backs out of the transfer step first.
    await page.keyboard.press("Escape");
    await expect(sheetOf(page).getByTestId("sheet-transfer")).toBeVisible();
    await closeSheet(page);

    // The goals screen shows what the goal holds, and the account sheet lists it.
    await page.goto("/settings/goals");
    const row = page.getByRole("list", { name: "Your goals" }).getByRole("listitem").filter({ hasText: goal });
    await expect(row.getByText("€120.00 of €3,000.00")).toBeVisible();
    await page.goto("/accounts");
    await rowMenuAction(page, savings, "Edit");
    await expect(manageSheet(page).getByTestId("account-goals")).toContainText(`${goal} · €120.00`);
    // closeSheet waits for the transaction sheet; this is the account sheet.
    await page.keyboard.press("Escape");
    await expect(manageSheet(page)).toBeHidden();
  } finally {
    await undoImport(page, file);
    await page.goto("/settings/goals");
    await rowMenuAction(page, goal, "Delete");
    await expect(toastWith(page, `${goal} deleted`)).toBeVisible();
  }
});
