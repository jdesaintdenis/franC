import { type Page } from "@playwright/test";

import { expect, test, type E2EUser } from "./fixtures";
import { isoDaysAgo } from "./helpers/dates";
import { addAccount } from "./helpers/manage";
import { sheetOf } from "./helpers/sheet";
import type postgres from "postgres";
import { chooseCsv } from "./helpers/imports";

const PREFIX = "E2E Manual";
const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

test.afterEach(async ({ sql, workerUser }) => {
  // Accounts own their rows, so one delete cleans everything the test made.
  await sql`delete from accounts where user_id = ${workerUser.id} and name like ${PREFIX + "%"}`;
});

/** An account that already has bank rows, like one fed by a CSV or a sync. Returns its id. */
async function fedAccount(
  sql: postgres.Sql,
  user: E2EUser,
  name: string,
  rows: Array<{ date: string; cents: number; label: string }> = [],
) {
  const [account] =
    await sql`insert into accounts (user_id, name) values (${user.id}, ${name}) returning id`;
  const [imp] = await sql`
    insert into imports (user_id, account_id, filename, kind, rows_total, rows_error)
    values (${user.id}, ${account.id}, 'x.csv', 'csv', ${rows.length}, 0) returning id`;
  let i = 0;
  for (const r of [
    { date: isoDaysAgo(60), cents: -100, label: "SEED" },
    ...rows,
  ]) {
    await sql`
      insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, dedupe_hash, occurrence_index, source)
      values (${user.id}, ${account.id}, ${imp.id}, ${r.date}, ${r.cents}, ${r.label}, ${r.label}, ${r.label}, ${`e2e-manual-${name}-${i++}`}, 0, 'csv')`;
  }
  return account.id as string;
}

async function addByHand(
  page: Page,
  account: string,
  label: string,
  amount: string,
  date?: string,
) {
  await page.goto("/transactions");
  await page.getByTestId("add-transaction").click();
  const sheet = page.getByRole("dialog", { name: "Add a transaction" });
  await sheet.getByTestId("add-amount").fill(amount);
  await sheet.getByTestId("add-label").fill(label);
  if (date) await sheet.getByTestId("add-date").fill(date);
  await sheet.getByTestId("add-account").selectOption({ label: account });
  await sheet.getByTestId("add-submit").click();
  await expect(sheet).toBeHidden();
}

test("Swile card: add an expense on an account of its own, edit it, delete it", async ({
  page,
}) => {
  const name = `${PREFIX} Swile`;
  await addAccount(page, name);
  await addByHand(page, name, "E2E Lunch", "12,50");
  const row = page.getByRole("button", { name: /E2E Lunch/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  const sheet = sheetOf(page);
  await expect(sheet.getByText(/Added by you/i)).toBeVisible();
  await sheet.getByTestId("sheet-edit").click();
  await sheet.getByTestId("add-label").fill("E2E Lunch edited");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(
    sheet.getByRole("heading", { name: "E2E Lunch edited" }),
  ).toBeVisible();
  await sheet.getByTestId("sheet-delete").click();
  await expect(
    page.getByRole("button", { name: /E2E Lunch edited/ }),
  ).toHaveCount(0);
});

test("a hand row waits on a fed account, and the CSV of the same purchase takes it over", async ({
  page,
  sql,
  workerUser,
}) => {
  const name = `${PREFIX} Fed`;
  await fedAccount(sql, workerUser, name);
  await addByHand(page, name, "E2E Cafe", "4,20");
  const [row] =
    await sql`select id, awaiting_bank from transactions where user_id = ${workerUser.id} and source = 'manual' and label_display = 'E2E Cafe'`;
  expect(row.awaiting_bank).toBe(true);

  const date = isoDaysAgo(1).split("-").reverse().join("/");
  const csv = `${HEADER}\n${date};CAFE DU COIN;CB CAFE DU COIN;E2E1;;Carte;;;-4,20;;${date};${date};0\n`;
  await page.goto("/import");
  await page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name: name }).click();
  await chooseCsv(page, {
      name: "e2e-manual.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  // The CSV row merges into the hand row, so nothing is "new": record it anyway.
  await page.getByRole("button", { name: /^(Import \d+ transaction|Record this import anyway)/ }).click();
  await expect
    .poll(
      async () =>
        (
          await sql`select 1 from transactions where user_id = ${workerUser.id} and source <> 'manual' and amount_cents = -420`
        ).length,
    )
    .toBe(1);

  const rows =
    await sql`select id, source, awaiting_bank, label_display from transactions where user_id = ${workerUser.id} and source <> 'manual' and amount_cents = -420`;
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(row.id);
  expect(rows[0].awaiting_bank).toBe(false);
});

test("not found: Keep ends the wait, Same as… links the bank row", async ({
  page,
  sql,
  workerUser,
}) => {
  const name = `${PREFIX} Late`;
  const accountId = await fedAccount(sql, workerUser, name, [
    { date: isoDaysAgo(9), cents: -777, label: "E2E BANKROW" },
  ]);
  await addByHand(page, name, "E2E Kept", "5,00", isoDaysAgo(12));
  await addByHand(page, name, "E2E Linked", "7,77", isoDaysAgo(12));
  // Added more than 7 days ago and not matched: both are not found.
  await page.goto("/review");
  const section = page.getByTestId("not-found");
  await expect(section.getByTestId("not-found-item")).toHaveCount(2);

  await section
    .getByTestId("not-found-item")
    .filter({ hasText: "E2E Kept" })
    .getByTestId("not-found-keep")
    .click();
  await expect(section.getByTestId("not-found-item")).toHaveCount(1);

  await section.getByTestId("not-found-link").click();
  await page
    .getByRole("dialog")
    .getByTestId("not-found-candidate")
    .filter({ hasText: "E2E BANKROW" })
    .click();
  await expect(section).toBeHidden();
  const left =
    await sql`select label_display from transactions where account_id = ${accountId} and source = 'manual'`;
  expect(left.map((r) => r.label_display)).toEqual(["E2E Kept"]);
});
