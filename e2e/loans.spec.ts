import { expect, test } from "./fixtures";
import { parisToday } from "./helpers/dates";

// Loans (Slice 67). The payments are seeded in SQL; the loan is created and corrected through the screens.
test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 390, height: 844 } });

const PREFIX = "E2E Loan";

/** "YYYY-MM" `offset` months from the current Paris month. */
function monthAt(offset: number): string {
  const [year, month] = parisToday().split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

test.afterEach(async ({ sql, workerUser }) => {
  await sql`delete from loans where user_id = ${workerUser.id} and name like ${PREFIX + "%"}`;
  await sql`delete from imports where user_id = ${workerUser.id} and filename like ${PREFIX + "%"}`;
  await sql`delete from recurring where user_id = ${workerUser.id} and merchant_key like ${PREFIX + "%"}`;
});

test("a loan is tracked from its bank payments, its split can be corrected, and nothing else changes", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const name = `${PREFIX} ${stamp}`;
  const label = `${PREFIX} Bank ${stamp}`;
  const [account] = await sql`select id from accounts where user_id = ${workerUser.id} order by created_at limit 1`;
  const [imp] = await sql`insert into imports (user_id, account_id, filename) values (${workerUser.id}, ${account.id}, ${PREFIX + " seed"}) returning id`;
  const [item] = await sql`
    insert into recurring (user_id, account_id, merchant_key, typical_amount_cents, interval, last_seen_date, next_expected_date, status)
    values (${workerUser.id}, ${account.id}, ${label}, -150000, 'monthly', ${`${monthAt(-1)}-05`}, ${`${monthAt(0)}-05`}, 'confirmed') returning id`;
  let n = 0;
  for (const date of [`${monthAt(-2)}-05`, `${monthAt(-1)}-05`]) {
    await sql`
      insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, recurring_id, dedupe_hash, occurrence_index)
      values (${workerUser.id}, ${account.id}, ${imp.id}, ${date}, -150000, ${label}, ${label.toLowerCase()}, ${label}, ${item.id}, ${`loan${stamp}${n++}`}, 0)`;
  }
  const [{ count: before }] = await sql`select count(*)::int as count from transactions where user_id = ${workerUser.id}`;

  // 1 000 € borrowed at 1,2 %: 100 € interest in month one, then 98,60 € of capital owed each month.
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Track a loan" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByLabel("Amount borrowed").fill("100000");
  await sheet.getByLabel("Capital still owed").fill("100000");
  await sheet.getByLabel("As of").fill(`${monthAt(-3)}-01`);
  await sheet.getByLabel("Interest rate (per year)").fill("1.2");
  await sheet.getByLabel("Last payment").fill(`${monthAt(-4)}-05`);
  await sheet.getByLabel("Paid by").selectOption(item.id as string);
  await sheet.getByRole("button", { name: "Save" }).click();

  // A refused save keeps everything that was typed.
  await expect(sheet.getByRole("alert")).toContainText("must come after");
  await expect(sheet.getByLabel("Name", { exact: true })).toHaveValue(name);
  await expect(sheet.getByLabel("Amount borrowed")).toHaveValue("100000");
  await expect(sheet.getByLabel("Paid by")).toHaveValue(item.id as string);
  await sheet.getByLabel("Last payment").fill(`${monthAt(60)}-05`);
  await sheet.getByRole("button", { name: "Save" }).click();

  // Month one: 1 500 € paid, 100 € interest, 1 400 € capital. Month two: 98,60 € interest, 1 401,40 € capital.
  await expect(page.getByTestId("loan-owed")).toContainText("97,198.60", { timeout: 20_000 });
  await expect(page.getByTestId("loan-hero")).toContainText("2% repaid");
  const rows = page.getByTestId("loan-payments").getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Capital €1,401.40 · interest €98.60");

  // The bank rows are untouched and the loan is on Comptes.
  const [{ count: after }] = await sql`select count(*)::int as count from transactions where user_id = ${workerUser.id}`;
  expect(after).toBe(before);
  await page.goto("/accounts");
  await expect(page.getByTestId("loans-list")).toContainText(name);
  await expect(page.getByTestId("loans-list")).toContainText("97,198.60");

  // Correct the latest payment: the bank says 120 € of interest, so 1 380 € of capital.
  await page.getByTestId("loans-list").getByRole("link", { name: new RegExp(name) }).click();
  await page.getByTestId("loan-payments").getByRole("listitem").first().getByRole("button").click();
  const split = page.getByRole("dialog");
  await split.getByLabel("Interest").fill("120");
  await expect(split.getByTestId("split-capital")).toContainText("€1,380.00");
  await split.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("loan-owed")).toContainText("97,220.00");

  // Nothing overflows sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Delete: back on Comptes, the loan is gone and the bank rows are still there.
  await page.getByRole("button", { name: "Delete loan" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: "Track a loan" })).toBeVisible();
  const [{ count: final }] = await sql`select count(*)::int as count from transactions where user_id = ${workerUser.id}`;
  expect(final).toBe(before);
});

test("a loan with a subscription date shows its deferral, one estimated period and its length", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const name = `${PREFIX} History ${stamp}`;
  const label = `${PREFIX} HBank ${stamp}`;
  const [account] = await sql`select id from accounts where user_id = ${workerUser.id} order by created_at limit 1`;
  const [imp] = await sql`insert into imports (user_id, account_id, filename) values (${workerUser.id}, ${account.id}, ${PREFIX + " seed"}) returning id`;
  const [item] = await sql`
    insert into recurring (user_id, account_id, merchant_key, typical_amount_cents, interval, last_seen_date, next_expected_date, status)
    values (${workerUser.id}, ${account.id}, ${label}, -150000, 'monthly', ${`${monthAt(-1)}-05`}, ${`${monthAt(0)}-05`}, 'confirmed') returning id`;
  let n = 0;
  for (const date of [`${monthAt(-2)}-05`, `${monthAt(-1)}-05`]) {
    await sql`
      insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, recurring_id, dedupe_hash, occurrence_index)
      values (${workerUser.id}, ${account.id}, ${imp.id}, ${date}, -150000, ${label}, ${label.toLowerCase()}, ${label}, ${item.id}, ${`hist${stamp}${n++}`}, 0)`;
  }

  await page.goto("/accounts");
  await page.getByRole("button", { name: "Track a loan" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByLabel("Amount borrowed").fill("100000");
  await sheet.getByLabel("Capital still owed").fill("90000");
  await sheet.getByLabel("Interest rate (per year)").fill("1.2");
  await sheet.getByLabel("Last payment").fill(`${monthAt(60)}-05`);
  await sheet.getByLabel("Paid by").selectOption(item.id as string);
  // The capital start date needs the subscription date first, and the refused save keeps what was typed.
  await sheet.getByLabel("Capital repayment starts").fill(`${monthAt(-12)}-05`);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet.getByRole("alert")).toContainText("Enter the subscription date first");
  await expect(sheet.getByLabel("Name", { exact: true })).toHaveValue(name);
  await sheet.getByLabel("Subscription date").fill(`${monthAt(-24)}-05`);
  await sheet.getByRole("button", { name: "Save" }).click();

  await expect(page.getByTestId("loan-owed")).toContainText("90,000.00", { timeout: 20_000 });
  const rows = page.getByTestId("loan-payments").getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId("loan-deferral")).toContainText("Capital unchanged");
  await expect(page.getByTestId("loan-estimated")).toContainText("Estimated period");
  await expect(page.getByTestId("loan-estimated")).toContainText("estimated");
  await expect(page.getByTestId("loan-length")).toContainText("months in all");
  await expect(page.getByTestId("loan-contract-end")).toContainText("Last payment");
  await expect(page.getByTestId("loan-curve")).toBeVisible();
});
