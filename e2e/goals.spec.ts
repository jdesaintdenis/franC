import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addAccount, deleteAccountsWithPrefix, manageSheet, openMenu, openRowMenu, rowMenuAction, setStartingBalance } from "./helpers/manage";
import { toastWith } from "./helpers/sheet";

// Every goal this spec creates carries the prefix so afterEach can remove it after a failure.
const PREFIX = "E2E Goal";

const list = (page: Page) => page.getByRole("list", { name: "Your goals" });

// The worker's E2E user is shared by the specs it runs: no goal may outlive this one, or every dashboard grows a card.
test.afterEach(async ({ page }) => {
  await page.goto("/settings/goals");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const options = new RegExp(`^Options for ${PREFIX}`);
  while ((await page.getByRole("button", { name: options }).count()) > 0) {
    const before = await page.getByRole("button", { name: options }).count();
    await page.getByRole("button", { name: options }).first().click();
    await openMenu(page).getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("button", { name: options })).toHaveCount(before - 1);
  }
  await deleteAccountsWithPrefix(page, PREFIX);
});

/**
 * Closes the open sheet with Escape. The dialog hands focus back in a timer right after it
 * unmounts, and a "⋯" tap landing before that is dismissed as a click outside the menu.
 */
async function closeSheetFor(page: Page) {
  await page.keyboard.press("Escape");
  await expect(manageSheet(page)).toBeHidden();
  await page.waitForTimeout(250);
}

/** Adds money to (or takes it out of) a manual goal from its "⋯" menu. */
async function moveMoney(page: Page, name: string, direction: "add" | "take", amount: string) {
  await rowMenuAction(page, name, direction === "add" ? "Add money" : "Take money out");
  // The sheet opens as the menu closes; wait for the menu to be gone before touching anything.
  await expect(page.getByRole("menu")).toBeHidden();
  const sheet = manageSheet(page);
  await sheet.getByLabel("Amount", { exact: true }).fill(amount);
  await sheet.getByRole("button", { name: direction === "add" ? "Add money" : "Take out" }).click();
  return sheet;
}

/** Paris today plus `months`, on the 28th so the day exists in every month; with its English label. */
function targetIn(months: number) {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" })
    .format(new Date())
    .split("-")
    .map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  return { iso: `${year}-${String(month).padStart(2, "0")}-28`, label };
}

test("goals: create a manual goal, add money, see the monthly amount on the dashboard, delete it", async ({ page }) => {
  const name = `${PREFIX} ${Date.now()}`;
  // The current and the target month both count: 5 months for 1 000 € still to save is 200 € each.
  const target = targetIn(4);

  await page.goto("/settings/goals");
  await expect(page.getByText("No savings goals yet")).toBeVisible();

  await page.getByRole("link", { name: /^(Add a goal|New goal)$/ }).click();
  const sheet = manageSheet(page);
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByLabel("Target", { exact: true }).fill("abc");
  await sheet.getByRole("button", { name: "Add goal" }).click();
  await expect(sheet.getByRole("alert").filter({ hasText: "amount in euros" })).toBeVisible();

  await sheet.getByLabel("Target", { exact: true }).fill("1200");
  await sheet.getByLabel("Target date (optional)").fill(target.iso);
  await sheet.getByRole("button", { name: "Add goal" }).click();
  await expect(sheet).toBeHidden();

  const row = list(page).getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText("by hand")).toBeVisible();

  // Taking out more than saved is refused; adding is recorded.
  const money = await moveMoney(page, name, "take", "50");
  await expect(money.getByRole("alert")).toContainText("more than what is saved");
  await closeSheetFor(page);

  await moveMoney(page, name, "add", "200");
  await expect(money).toBeHidden();
  await expect(row.getByText("€200.00 of €1,200.00")).toBeVisible();

  // Dashboard card, no horizontal overflow on a phone.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const card = page.getByRole("region", { name: "Goals", exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByText(name)).toBeVisible();
  await expect(card.getByText("€200.00 of €1,200.00")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // The Budget page shows the same goal rows as Home.
  await page.goto("/budget");
  const planCard = page.getByRole("region", { name: "Goals", exact: true });
  await expect(planCard.getByText(name)).toBeVisible();
  await expect(planCard.getByText("€200.00 of €1,200.00")).toBeVisible();

  // Removing the entry brings the saved amount back to 0.
  await page.goto("/settings/goals");
  await rowMenuAction(page, name, "Add money");
  const entries = manageSheet(page).getByRole("list", { name: `Recent entries for ${name}` });
  await expect(entries.getByText("+€200.00", { exact: true })).toBeVisible();
  await manageSheet(page).getByRole("button", { name: /^Remove/ }).click();
  await expect(manageSheet(page).getByText("No entries yet.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(manageSheet(page)).toBeHidden();

  await rowMenuAction(page, name, "Delete");
  await expect(toastWith(page, `${name} deleted`)).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Goals", exact: true })).toBeHidden();
});

test("goals: the menu opens the right sheet; deleting offers Undo that brings back the money", async ({ page }) => {
  const name = `${PREFIX} ${Date.now()} menu`;
  await page.goto("/settings/goals");
  await page.getByRole("link", { name: /^(Add a goal|New goal)$/ }).click();
  const sheet = manageSheet(page);
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByLabel("Target", { exact: true }).fill("500");
  await sheet.getByRole("button", { name: "Add goal" }).click();
  await expect(sheet).toBeHidden();
  const row = list(page).getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();

  // Manual goal: money in and out, edit, delete.
  const menu = await openRowMenu(page, name);
  await expect(menu.getByRole("menuitem")).toHaveText(["Add money", "Take money out", "Edit", "Delete"]);
  await menu.getByRole("menuitem", { name: "Take money out" }).click();
  await expect(menu).toBeHidden();
  await expect(sheet).toHaveAccessibleName(`Take money out of ${name}`);
  await closeSheetFor(page);

  await moveMoney(page, name, "add", "120");
  await expect(row.getByText("€120.00 of €500.00")).toBeVisible();

  // "Edit" and tapping the row open the edit sheet.
  await rowMenuAction(page, name, "Edit");
  await expect(sheet).toHaveAccessibleName(name);
  await expect(sheet.getByLabel("Name", { exact: true })).toHaveValue(name);
  await closeSheetFor(page);
  await row.getByRole("button").first().click();
  await expect(sheet.getByLabel("Target", { exact: true })).toHaveValue("500");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Delete is immediate; Undo restores the goal with its money.
  await rowMenuAction(page, name, "Delete");
  await expect(row).toHaveCount(0);
  await toastWith(page, `${name} deleted`).getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible();
  await expect(row.getByText("€120.00 of €500.00")).toBeVisible();
});

test("goals: assign money from Not assigned, limited to what the account has left", async ({ page }) => {
  const stamp = Date.now();
  const account = `${PREFIX} Account ${stamp}`;
  const name = `${PREFIX} ${stamp} assign`;
  await addAccount(page, account);
  await setStartingBalance(page, account, "500,00");

  await page.goto("/settings/goals");
  await page.getByRole("link", { name: /^(Add a goal|New goal)$/ }).click();
  const sheet = manageSheet(page);
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByLabel("Target", { exact: true }).fill("1000");
  await sheet.getByRole("radio", { name: "On an account" }).click();
  await sheet.getByRole("radio", { name: account, exact: true }).click();
  await sheet.getByRole("button", { name: "Add goal" }).click();
  await expect(sheet).toBeHidden();

  const row = list(page).getByRole("listitem").filter({ hasText: name });
  const notAssigned = page.getByTestId("not-assigned");
  await expect(row.getByText(account)).toBeVisible();
  await expect(row.getByText("€0.00 of €1,000.00")).toBeVisible();
  const card = notAssigned.getByRole("listitem").filter({ hasText: account });
  await expect(card).toContainText("€500.00");
  await expect(card).toContainText("€0.00 assigned · €500.00 to assign");

  // Account goals assign and unassign instead of adding by hand.
  const menu = await openRowMenu(page, name);
  await expect(menu.getByRole("menuitem")).toHaveText(["Assign money", "Unassign money", "Edit", "Delete"]);
  await menu.getByRole("menuitem", { name: "Assign money", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(sheet.getByText("€500.00 not assigned in")).toBeVisible();
  await sheet.getByLabel("Amount", { exact: true }).fill("600");
  await sheet.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(sheet.getByRole("alert")).toContainText("more than what's not assigned");

  await sheet.getByLabel("Amount", { exact: true }).fill("200");
  await sheet.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(row.getByText("€200.00 of €1,000.00")).toBeVisible();
  await expect(card).toContainText("€200.00 assigned · €300.00 to assign");
  await page.waitForTimeout(250);

  // Taking back more than the goal holds is refused.
  await rowMenuAction(page, name, "Unassign money");
  await expect(page.getByRole("menu")).toBeHidden();
  await sheet.getByLabel("Amount", { exact: true }).fill("250");
  await sheet.getByRole("button", { name: "Unassign", exact: true }).click();
  await expect(sheet.getByRole("alert")).toContainText("more than what is saved");
});
