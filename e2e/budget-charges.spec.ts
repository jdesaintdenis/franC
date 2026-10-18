import { expect, test } from "./fixtures";
import { parisToday } from "./helpers/dates";
import { clearStartingBalances, setStartingBalance } from "./helpers/manage";

// Regular payments inside budgets (Slice 66). Data is seeded in SQL; the pages are what is under test.
test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 390, height: 844 } });

const PREFIX = "E2E Charges";

/** "YYYY-MM" `offset` months from the current Paris month. */
function monthAt(offset: number): string {
  const [year, month] = parisToday().split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

test.afterEach(async ({ page, sql, workerUser }) => {
  await sql`delete from imports where user_id = ${workerUser.id} and filename like ${PREFIX + "%"}`;
  await sql`delete from recurring where user_id = ${workerUser.id} and merchant_key like ${PREFIX + "%"}`;
  await sql`delete from categories where user_id = ${workerUser.id} and name like ${PREFIX + "%"}`;
  await clearStartingBalances(page);
});

test("budgets show their regular payments: due and paid, left to spend, payments-only budgets folded", async ({ page, sql, workerUser }) => {
  const today = parisToday();
  const dayOfMonth = Number(today.slice(8, 10));
  // A bill due later this month needs a day after today that exists in every month.
  test.skip(dayOfMonth > 25, "no room left in the month for a bill still due");
  const dueDay = String(dayOfMonth + 2).padStart(2, "0");
  const current = monthAt(0);
  const previous = monthAt(-1);

  const stamp = Date.now();
  const sportName = `${PREFIX} Sport ${stamp}`;
  const taxName = `${PREFIX} Tax ${stamp}`;
  const gym = `${PREFIX} Gym ${stamp}`;
  const dgfip = `${PREFIX} DGFIP ${stamp}`;
  const [account] = await sql`select id, name from accounts where user_id = ${workerUser.id} order by created_at limit 1`;
  const [imp] = await sql`insert into imports (user_id, account_id, filename) values (${workerUser.id}, ${account.id}, ${PREFIX + " seed"}) returning id`;
  const [sport] = await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${sportName}, '#2255aa') returning id`;
  const [tax] = await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${taxName}, '#aa7722') returning id`;
  await sql`insert into category_budgets (category_id, user_id, amount_cents) values (${sport.id}, ${workerUser.id}, 20000)`;
  await sql`insert into category_budgets (category_id, user_id, amount_cents) values (${tax.id}, ${workerUser.id}, 10700)`;

  const item = async (key: string, amount: number, lastSeen: string, next: string) => {
    const [row] = await sql`
      insert into recurring (user_id, account_id, merchant_key, typical_amount_cents, interval, last_seen_date, next_expected_date, status)
      values (${workerUser.id}, ${account.id}, ${key}, ${amount}, 'monthly', ${lastSeen}, ${next}, 'confirmed') returning id`;
    return row.id as string;
  };
  const gymId = await item(gym, -15000, `${previous}-${dueDay}`, `${current}-${dueDay}`);
  const taxId = await item(dgfip, -10700, `${current}-01`, `${monthAt(1)}-01`);

  let n = 0;
  const tx = async (date: string, amount: number, label: string, categoryId: string, recurringId: string | null) => {
    await sql`
      insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, category_id, category_source, recurring_id, dedupe_hash, occurrence_index)
      values (${workerUser.id}, ${account.id}, ${imp.id}, ${date}, ${amount}, ${label}, ${label.toLowerCase()}, ${label}, ${categoryId}, 'manual', ${recurringId}, ${`chg${stamp}${n++}`}, 0)`;
  };
  // Last month's gym charge names the item and gives it its category; this month's tax is already paid.
  await tx(`${previous}-${dueDay}`, -15000, gym, sport.id, gymId);
  await tx(`${previous}-01`, -10700, dgfip, tax.id, taxId);
  await tx(`${current}-01`, -10700, dgfip, tax.id, taxId);
  await tx(`${current}-01`, -2240, `${PREFIX} Other`, sport.id, null);

  await setStartingBalance(page, account.name, "5 000,00");

  // The Budget page: the gym is due (150 € of the 200 € budget), 27,60 € is left, the tax budget is folded.
  await page.goto("/budget");
  const budgets = page.getByTestId("plan-budgets");
  const sportRow = budgets.getByRole("link").filter({ hasText: sportName });
  await expect(sportRow).toContainText("€150.00 due");
  await expect(sportRow).toContainText("€27.60 left to spend");
  await expect(sportRow.getByRole("listitem")).toHaveCount(1);
  await expect(sportRow.getByRole("listitem")).toContainText(gym);
  await expect(sportRow.getByRole("listitem")).toContainText(/^.*due /);
  await expect(budgets.getByRole("link").filter({ hasText: taxName })).toHaveCount(0);
  await page.getByRole("button", { name: "Show the payments-only budget" }).click();
  const taxRow = page.getByTestId("charges-only-fold").getByRole("link").filter({ hasText: taxName });
  await expect(taxRow.getByRole("listitem")).toContainText(dgfip);
  await expect(taxRow.getByRole("listitem")).toContainText("paid ");
  await page.getByRole("button", { name: "Hide payments-only budgets" }).click();
  await expect(taxRow).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Home: the gauge and the due amount, no payment lines, the payments-only budget left out.
  await page.goto("/");
  const home = page.getByTestId("home-budgets");
  await expect(home.getByRole("link").filter({ hasText: sportName })).toContainText("€150.00 due");
  await expect(home).not.toContainText(gym);
  await expect(home.getByRole("link").filter({ hasText: taxName })).toHaveCount(0);

  // Budgets settings: every budget, and the sheet offers the payments as an amount.
  await page.goto("/settings/budgets");
  await expect(page.getByRole("button", { name: `Edit budget for ${taxName}` })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^Edit budget for ${sportName}`) }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Payments · €150" }).click();
  await expect(sheet.getByLabel("Monthly budget")).toHaveValue("150");
  await expect(sheet).toContainText(gym);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // A finished month: only what was paid, no due amount, nothing left to spend, no pace tick.
  await page.goto(`/budget?month=${previous}`);
  const past = page.getByTestId("plan-budgets");
  const pastSport = past.getByRole("link").filter({ hasText: sportName });
  await expect(pastSport).toContainText(gym);
  await expect(pastSport).toContainText("paid ");
  await expect(pastSport).not.toContainText("due");
  await expect(pastSport).not.toContainText("left to spend");
  await expect(pastSport.locator("[data-pace]")).toHaveCount(0);
});

test("a regular payment creates its category's budget, folded once the payment covers 95 % of it", async ({ page, sql, workerUser }) => {
  const current = monthAt(0);
  const stamp = Date.now();
  const categoryName = `${PREFIX} Box ${stamp}`;
  const merchant = `${PREFIX} Fibre ${stamp}`;
  const [account] = await sql`select id from accounts where user_id = ${workerUser.id} order by created_at limit 1`;
  const [imp] = await sql`insert into imports (user_id, account_id, filename) values (${workerUser.id}, ${account.id}, ${PREFIX + " seed"}) returning id`;
  const [category] = await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${categoryName}, '#2255aa') returning id`;
  const [item] = await sql`
    insert into recurring (user_id, account_id, merchant_key, typical_amount_cents, interval, last_seen_date, next_expected_date, status)
    values (${workerUser.id}, ${account.id}, ${merchant}, -12399, 'monthly', ${`${current}-01`}, ${`${monthAt(1)}-01`}, 'confirmed') returning id`;
  await sql`
    insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, category_id, category_source, recurring_id, dedupe_hash, occurrence_index)
    values (${workerUser.id}, ${account.id}, ${imp.id}, ${`${current}-01`}, -12399, ${merchant}, ${merchant.toLowerCase()}, ${merchant}, ${category.id}, 'manual', ${item.id}, ${`box${stamp}`}, 0)`;

  // The payment's sheet opens a new budget for its category, pre-filled with the payment.
  await page.goto(`/recurring?item=${item.id}`);
  await page.getByRole("dialog").getByRole("link", { name: `Create a ${categoryName} budget` }).click();
  await expect(page).toHaveURL(/\/settings\/budgets/);
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("Monthly budget")).toHaveValue("123.99");
  // Rounded up to 124 €, the 123,99 € payment still covers it: the Budget page folds it.
  await sheet.getByLabel("Monthly budget").fill("124");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: `Edit budget for ${categoryName}` })).toBeVisible();

  await page.goto("/budget");
  await expect(page.getByTestId("plan-budgets").getByRole("link").filter({ hasText: categoryName })).toHaveCount(0);
  await page.getByRole("button", { name: /^Show the .*payments-only budget/ }).click();
  await expect(page.getByTestId("charges-only-fold").getByRole("link").filter({ hasText: categoryName })).toBeVisible();

  // Back on the payment, the link now opens the existing budget.
  await page.goto(`/recurring?item=${item.id}`);
  await expect(page.getByRole("dialog").getByRole("link", { name: `Open the ${categoryName} budget` })).toBeVisible();
});
