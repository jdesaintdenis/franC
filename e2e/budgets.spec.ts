import { type Page } from "@playwright/test";
import type postgres from "postgres";

import { expect, test } from "./fixtures";
import { manageSheet, openRowMenu, rowMenuAction, setBudget } from "./helpers/manage";
import { chooseCsv } from "./helpers/imports";

// Each test imports a file, sets budgets and undoes the import: well over the default 30 s on a cold dev server.
test.describe.configure({ timeout: 90_000 });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

// Every category this spec creates carries the prefix so afterEach can remove it after a failure.
const PREFIX = "E2E Budget";

test.afterEach(async ({ sql, workerUser }) => {
  // Budgets and rules go with their category.
  await sql`delete from categories where user_id = ${workerUser.id} and name like ${PREFIX + "%"}`;
});

/** A category plus a rule, so the row imported next lands in it. Seeded in SQL: this spec is about budgets. */
async function seedCategory(sql: postgres.Sql, userId: string, name: string, merchant: string) {
  const [category] = await sql`
    insert into categories (user_id, name, color) values (${userId}, ${name}, '#112233') returning id`;
  await sql`
    insert into category_rules (user_id, category_id, match_type, pattern)
    values (${userId}, ${category.id}, 'contains', ${merchant})`;
}

async function importSpend(page: Page, file: string, merchant: string, date: string, amount: string) {
  const line = `${date};${merchant};PRLV ${merchant};REF1;REF1-;Prelevement;;;${amount};;${date};${date};0`;
  await page.goto("/import");
  await chooseCsv(page, {
    name: file,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, line].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await expect(page.getByText("1 imported")).toBeVisible();
}

/** The 3rd of last month (Europe/Paris), as the bank CSV writes it: where the averages read from. */
function lastMonthDate(): string {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  const last = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  return `03/${String(last.m).padStart(2, "0")}/${last.y}`;
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

test("budgets: set on a category, over budget on the dashboard, removed", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const name = `${PREFIX} ${stamp}`;
  const merchant = `ZQBUDGET${stamp}`;
  const file = `budgets-${stamp}.csv`;
  // A random month in 2011-2020 keeps the totals free of other specs' data.
  const year = 2011 + Math.floor(Math.random() * 10);
  const mm = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const month = `${year}-${mm}`;

  await seedCategory(sql, workerUser.id, name, merchant);
  await importSpend(page, file, merchant, `10/${mm}/${year}`, "-50,00");

  try {
    // Invalid input is refused; a valid one is saved.
    await page.goto("/settings/budgets?add=1");
    const sheet = manageSheet(page);
    await sheet.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await sheet.getByLabel("Monthly budget").fill("abc");
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet.getByRole("alert")).toContainText("Enter an amount");
    await sheet.getByLabel("Monthly budget").fill("10,50");
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Budget saved", { exact: true })).toBeVisible();
    await expect(sheet).toBeHidden();
    await page.reload();
    await page.getByRole("button", { name: `Edit budget for ${name}`, exact: true }).click();
    await expect(manageSheet(page).getByLabel("Monthly budget")).toHaveValue("10.50");

    // 50 spent of 10.50: over by 39.50.
    await page.goto(`/budget?month=${month}`);
    const budgets = page.getByRole("region", { name: "Budgets" });
    const row = budgets.getByRole("link").filter({ hasText: name });
    await expect(row).toContainText("€39.50 over");
    await expect(budgets).toContainText("€50.00 of €10.50");

    // Removing the budget removes the row.
    await page.goto("/settings/budgets");
    await rowMenuAction(page, name, "Remove budget");
    await expect(page.getByText("Budget removed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Edit budget for ${name}`, exact: true })).toHaveCount(0);
    await page.goto(`/budget?month=${month}`);
    await expect(page.getByRole("link", { name: new RegExp(name) }).filter({ hasText: "over" })).toHaveCount(0);
  } finally {
    await undoImport(page, file);
  }
});

test("budgets: presets fill the amount and rollover is set per budget", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const name = `${PREFIX} Roll ${stamp}`;
  const merchant = `ZQROLL${stamp}`;
  const file = `budgets-roll-${stamp}.csv`;

  await seedCategory(sql, workerUser.id, name, merchant);
  await importSpend(page, file, merchant, lastMonthDate(), "-49,20");

  try {
    await page.goto("/settings/budgets?add=1");
    const sheet = manageSheet(page);
    await sheet.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    const field = sheet.getByLabel("Monthly budget");
    // 49.20 spent last month, rounded up to the euro: prefilled, and the chips say the same.
    await expect(field).toHaveValue("50");
    // Last month equals the average once rounded: only one chip is offered.
    await expect(sheet.getByRole("button", { name: /^Last month/ })).toHaveCount(0);
    await field.fill("");
    await sheet.getByRole("button", { name: /^Use average · €50$/ }).click();
    await expect(field).toHaveValue("50");
    await sheet.getByRole("switch", { name: "Roll over" }).click();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Budget saved", { exact: true })).toBeVisible();
    await expect(sheet).toBeHidden();

    await page.reload();
    const row = page.getByRole("button", { name: `Edit budget for ${name}`, exact: true });
    await expect(row).toContainText("Rolls over");
    await row.click();
    await expect(field).toHaveValue("50");
    await expect(sheet.getByRole("switch", { name: "Roll over" })).toBeChecked();

    // Turning it off says the carry is gone.
    await sheet.getByRole("switch", { name: "Roll over" }).click();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Budget saved. The carried amount was reset.")).toBeVisible();
    await expect(sheet).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: `Edit budget for ${name}`, exact: true })).not.toContainText("Rolls over");
  } finally {
    await undoImport(page, file);
  }
});

test("budgets: empty state suggests a category, edit in the sheet, remove then Undo", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const name = `${PREFIX} Life ${stamp}`;
  const merchant = `ZQLIFE${stamp}`;
  const file = `budgets-life-${stamp}.csv`;

  // The average divides by the months since the first transaction: start from a clean slate.
  await sql`delete from transactions where user_id = ${workerUser.id}`;
  await seedCategory(sql, workerUser.id, name, merchant);
  // Large enough to head the "biggest expenses" suggestions whatever else the user has.
  await importSpend(page, file, merchant, lastMonthDate(), "-1234,00");
  await sql`delete from category_budgets where user_id = ${workerUser.id}`;

  try {
    // No budgets: the empty state offers the biggest spenders, one tap from a budget.
    await page.goto("/settings/budgets");
    await expect(page.getByRole("heading", { name: "No budgets yet" })).toBeVisible();
    const suggestion = page.getByRole("listitem").filter({ hasText: name });
    await expect(suggestion).toContainText("€1,234 a month on average");
    await suggestion.getByRole("button", { name: `Add a budget for ${name}` }).click();
    const sheet = manageSheet(page);
    await expect(page).toHaveURL(/\?edit=/);
    await expect(sheet.getByLabel("Monthly budget")).toHaveValue("1234");
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet).toBeHidden();

    // Now it is a row with its bar, nothing spent this month yet.
    const row = page.getByRole("button", { name: `Edit budget for ${name}`, exact: true });
    await expect(row).toContainText("€0.00 of €1,234.00");
    // No regular payment in this category: what is left still shows.
    await expect(row).toContainText("€1,234.00 left to spend");
    await expect(page.getByText("planned per month")).toContainText("€1,234");

    // Edit the amount and turn roll over on, in the sheet.
    await row.click();
    await sheet.getByLabel("Monthly budget").fill("300");
    await sheet.getByRole("switch", { name: "Roll over" }).click();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(row).toContainText("€0.00 of €300.00");
    await expect(row).toContainText("Rolls over");

    // The menu leads to this month's transactions of the category, and removes the budget.
    const menu = await openRowMenu(page, name);
    await expect(menu.getByRole("menuitem", { name: "See transactions" })).toHaveAttribute("href", /\/transactions\?/);

    // Remove, then Undo: same amount and same roll over.
    await menu.getByRole("menuitem", { name: "Remove budget" }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(row).toContainText("€0.00 of €300.00");
    await expect(row).toContainText("Rolls over");
  } finally {
    await undoImport(page, file);
  }
});

test("budgets: setBudget helper edits an existing budget and nests under its parent", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const parent = `${PREFIX} Parent ${stamp}`;
  const child = `${PREFIX} Child ${stamp}`;
  const [p] = await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${parent}, '#112233') returning id`;
  await sql`insert into categories (user_id, name, color, parent_id) values (${workerUser.id}, ${child}, '#445566', ${p.id})`;

  await setBudget(page, parent, "100");
  await setBudget(page, child, "150");
  await setBudget(page, parent, "200");
  await page.goto("/settings/budgets");
  const group = page.getByRole("list", { name: `Subcategory budgets of ${parent}` });
  await expect(group.getByRole("button", { name: `Edit budget for ${child}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Edit budget for ${parent}`, exact: true })).toContainText("€200.00");
  // Subcategories within a budgeted parent: no warning while they fit.
  await expect(page.getByRole("note")).toHaveCount(0);
  await setBudget(page, parent, "100");
  await page.goto("/settings/budgets");
  await expect(page.getByRole("note")).toContainText("more than");
});
