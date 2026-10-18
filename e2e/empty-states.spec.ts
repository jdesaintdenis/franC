import { expect, test } from "./fixtures";

// The worker user keeps data across spec files: start every test from an account and nothing else.
test.beforeEach(async ({ sql, workerUser: user }) => {
  await sql`delete from transactions where user_id = ${user.id}`;
  await sql`delete from recurring where user_id = ${user.id}`;
  await sql`delete from imports where user_id = ${user.id}`;
  await sql`delete from category_rules where user_id = ${user.id}`;
  await sql`delete from category_budgets where user_id = ${user.id}`;
  await sql`delete from savings_goals where user_id = ${user.id}`;
  await sql`delete from merchants where user_id = ${user.id}`;
  await sql`delete from tags where user_id = ${user.id}`;
  await sql`delete from categories where user_id = ${user.id}`;
});

test("transactions: nothing imported yet offers the import link", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "No transactions yet" })).toBeVisible();
  await page.getByRole("link", { name: "Import your bank export" }).click();
  await expect(page).toHaveURL(/\/import/);
});

test("transactions: an empty filtered result offers a working Clear filters link", async ({ page }) => {
  await page.goto(`/transactions?q=no-such-label-${Date.now()}`);
  await expect(page.getByRole("heading", { name: "Nothing matches" })).toBeVisible();
  // The count line is not repeated when the list explains the empty state.
  await expect(page.getByText("0 transactions")).toHaveCount(0);

  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByRole("heading", { name: "Nothing matches" })).toHaveCount(0);
});

for (const { path, title, action } of [
  { path: "/settings/categories", title: "No categories yet", action: "Add a category" },
  { path: "/settings/rules", title: "No rules yet", action: "Add a rule" },
  { path: "/settings/merchants", title: "No merchant names yet", action: "Add a merchant name" },
  { path: "/settings/goals", title: "No savings goals yet", action: "Add a goal" },
]) {
  test(`${path}: the empty state's Add opens the add sheet`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("link", { name: action, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}

test("tags: the empty state leads to the transactions", async ({ page }) => {
  await page.goto("/settings/tags");
  await expect(page.getByRole("heading", { name: "No tags yet" })).toBeVisible();
  await page.getByRole("link", { name: "Go to transactions" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
});

test("bank categories: the empty state leads to the import", async ({ page, sql, workerUser: user }) => {
  await sql`delete from bank_category_mappings where user_id = ${user.id}`;
  await page.goto("/settings/bank-categories");
  await expect(page.getByRole("heading", { name: "No bank categories yet" })).toBeVisible();
  await page.getByRole("link", { name: "Import your bank export" }).click();
  await expect(page).toHaveURL(/\/import/);
});

test("regular payments: with nothing imported the action is Import", async ({ page }) => {
  await page.goto("/recurring");
  await expect(page.getByRole("heading", { name: "No regular payments yet" })).toBeVisible();
  await page.getByRole("link", { name: "Import your bank export" }).click();
  await expect(page).toHaveURL(/\/import/);
});

test("regular payments: with transactions the action is to look for them now", async ({ page, sql, workerUser: user }) => {
  const [account] = await sql`select id from accounts where user_id = ${user.id} limit 1`;
  const [imp] = await sql`insert into imports (user_id, account_id, filename) values (${user.id}, ${account.id}, 'empty.csv') returning id`;
  await sql`
    insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, dedupe_hash, occurrence_index)
    values (${user.id}, ${account.id}, ${imp.id}, '2020-03-04', -500, 'ZQEMPTY', 'zqempty', 'ZQEMPTY', 'zqempty1', 0)`;
  await page.goto("/recurring");
  await expect(page.getByRole("heading", { name: "No regular payments yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import your bank export" })).toHaveCount(0);
  await page.getByRole("button", { name: "Look for them now" }).click();
  await expect(page.getByText("No new recurring payments")).toBeVisible();
});

test("year: a year without data offers the import, and another year when one has data", async ({ page, sql, workerUser: user }) => {
  await page.goto("/year?year=2019");
  await expect(page.getByRole("heading", { name: "Nothing in 2019" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Go to 20/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Import your bank export" })).toBeVisible();

  const [account] = await sql`select id from accounts where user_id = ${user.id} limit 1`;
  const [imp] = await sql`insert into imports (user_id, account_id, filename) values (${user.id}, ${account.id}, 'empty.csv') returning id`;
  await sql`
    insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, dedupe_hash, occurrence_index)
    values (${user.id}, ${account.id}, ${imp.id}, '2020-03-04', -500, 'ZQEMPTY', 'zqempty', 'ZQEMPTY', 'zqempty2', 0)`;
  await page.goto("/year?year=2019");
  await page.getByRole("link", { name: "Go to 2020" }).click();
  await expect(page).toHaveURL(/year=2020/);
});

test("next month: nothing expected links to the regular payments", async ({ page }) => {
  await page.goto("/budget/next-month");
  await expect(page.getByRole("heading", { name: "Nothing expected next month" })).toBeVisible();
  await page.getByRole("link", { name: "See regular payments" }).click();
  await expect(page).toHaveURL(/\/recurring/);
});

test("unknown routes show the not-found page with a way home", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go to dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
});
