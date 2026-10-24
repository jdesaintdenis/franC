import { expect, test } from "./fixtures";
import { parisToday } from "./helpers/dates";

// Compare two months (Slice 78). Data is seeded in SQL: the page is what is under test.
test.describe.configure({ timeout: 90_000 });
test.use({ viewport: { width: 390, height: 844 } });

const PREFIX = "E2E Compare";

/** "YYYY-MM" `offset` months from the current Paris month. */
function monthAt(offset: number): string {
  const [year, month] = parisToday().split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (month: string) => `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

test.afterEach(async ({ sql, workerUser }) => {
  await sql`delete from imports where user_id = ${workerUser.id} and filename like ${PREFIX + "%"}`;
  await sql`delete from category_budgets where user_id = ${workerUser.id} and category_id in (select id from categories where user_id = ${workerUser.id} and name like ${PREFIX + "%"})`;
  await sql`delete from categories where user_id = ${workerUser.id} and name like ${PREFIX + "%"}`;
});

test("compares two months: totals, categories by change, budgets, swap and picking months", async ({ page, sql, workerUser }) => {
  const current = monthAt(0);
  const m1 = monthAt(-2);
  const m2 = monthAt(-4);
  const stamp = Date.now();
  const food = `${PREFIX} Food ${stamp}`;
  const car = `${PREFIX} Car ${stamp}`;
  const salary = `${PREFIX} Salary ${stamp}`;

  const [account] = await sql`select id from accounts where user_id = ${workerUser.id} order by created_at limit 1`;
  const [imp] = await sql`insert into imports (user_id, account_id, filename) values (${workerUser.id}, ${account.id}, ${PREFIX + " seed"}) returning id`;
  const [foodCat] = await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${food}, '#0891b2') returning id`;
  const [carCat] = await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${car}, '#64748b') returning id`;
  const [salaryCat] = await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${salary}, '#22c55e') returning id`;
  await sql`insert into category_budgets (category_id, user_id, amount_cents) values (${foodCat.id}, ${workerUser.id}, 40000)`;
  let n = 0;
  const tx = async (date: string, amount: number, categoryId: string) => {
    await sql`
      insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, category_id, category_source, dedupe_hash, occurrence_index)
      values (${workerUser.id}, ${account.id}, ${imp.id}, ${date}, ${amount}, ${PREFIX}, ${PREFIX.toLowerCase()}, ${PREFIX}, ${categoryId}, 'manual', ${`cmp${stamp}${n++}`}, 0)`;
  };
  // m1 spends €300 on food; m2 spends €500 on food and €10,000 on the car, so the car leads the list.
  await tx(`${m1}-10`, -30000, foodCat.id);
  await tx(`${m2}-10`, -50000, foodCat.id);
  await tx(`${m2}-12`, -1000000, carCat.id);
  await tx(`${m1}-02`, 300000, salaryCat.id);
  await tx(`${m2}-02`, 300000, salaryCat.id);

  // The month card links to the comparison with the month before.
  await page.goto(`/budget?month=${m1}`);
  await page.getByRole("link", { name: "Compare with another month" }).click();
  await expect(page).toHaveURL(new RegExp(`/budget/compare\\?a=${m1}&b=${monthAt(-3)}$`));

  await page.goto(`/budget/compare?a=${m1}&b=${m2}`);
  await expect(page.getByTestId("compare-pill-a")).toHaveAccessibleName(`Change month ${label(m1)}`);
  await expect(page.getByTestId("compare-pill-b")).toHaveAccessibleName(`Change month ${label(m2)}`);
  await expect(page.getByTestId("compare-answer")).toContainText("less spent than in");

  // Biggest change first; a category spent in one month only counts €0 in the other.
  const rows = page.getByTestId("compare-category").filter({ hasText: PREFIX });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole("link")).toHaveAccessibleName(new RegExp(`^${car}: €0 in .*, €10,000 in .*, difference -€10,000$`));
  await expect(rows.nth(0)).toContainText("-100%");
  await expect(rows.nth(1).getByRole("link")).toHaveAccessibleName(new RegExp(`^${food}: €300 in .*, €500 in .*, difference -€200$`));
  await expect(rows.nth(1)).toContainText("-40%");
  await expect(page.getByTestId("compare-budget").filter({ hasText: food })).toContainText("75% vs 125%");

  // A row opens month A's transactions for that category.
  await rows.nth(1).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?.*from=${m1}-01.*category=${foodCat.id}`));

  // Swap puts the months the other way round.
  await page.goto(`/budget/compare?a=${m1}&b=${m2}`);
  await page.getByTestId("compare-swap").click();
  await expect(page).toHaveURL(new RegExp(`a=${m2}&b=${m1}$`));
  await expect(page.getByTestId("compare-answer")).toContainText("more spent than in");
  await expect(page.getByTestId("compare-category").filter({ hasText: car })).toContainText("new");

  // Pill B's picker: A's month is taken, another month replaces B.
  await page.getByTestId("compare-pill-b").click();
  const picker = page.getByTestId("month-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByText(/^Compare .* with…$/)).toBeVisible();
  await expect(picker.locator('[data-state="taken"]')).toHaveAccessibleName(`${label(m2)}, already picked`);
  await picker.getByRole("link", { name: new RegExp(`^${label(current)}, .* spent$`) }).click();
  await expect(page).toHaveURL(new RegExp(`a=${m2}&b=${current}$`));
  await expect(page.getByText(`${MONTH_NAMES[Number(current.slice(5)) - 1]} is in progress`, { exact: false })).toBeVisible();

  // The same month twice, or a month in the future, is normalised.
  await page.goto(`/budget/compare?a=${m1}&b=${m1}`);
  await expect(page.getByTestId("compare-pill-b")).toHaveAccessibleName(`Change month ${label(monthAt(-3))}`);
  await page.goto("/budget/compare?a=2099-01");
  await expect(page.getByTestId("compare-pill-a")).toHaveAccessibleName(`Change month ${label(current)}`);
});
