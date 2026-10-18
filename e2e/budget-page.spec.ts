import { expect, test } from "./fixtures";
import { parisToday } from "./helpers/dates";

// One Budget page for any month (Slice 59). Data is seeded in SQL: the page is what is under test.
test.describe.configure({ timeout: 90_000 });

const PREFIX = "E2E BudgetPage";

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
  await sql`delete from categories where user_id = ${workerUser.id} and name like ${PREFIX + "%"}`;
});

test("budget page: any month, picker, bars, rollover wording and no red", async ({ page, sql, workerUser }) => {
  const stamp = Date.now();
  const spendName = `${PREFIX} Spend ${stamp}`;
  const rollName = `${PREFIX} Roll ${stamp}`;
  const [account] = await sql`select id from accounts where user_id = ${workerUser.id} limit 1`;
  const [imp] = await sql`insert into imports (user_id, account_id, filename) values (${workerUser.id}, ${account.id}, ${PREFIX + " seed"}) returning id`;
  const [spend] = await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${spendName}, '#2255aa') returning id`;
  const [roll] = await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${rollName}, '#aa7722') returning id`;
  await sql`insert into category_budgets (category_id, user_id, amount_cents) values (${spend.id}, ${workerUser.id}, 5000)`;
  // Rollover from two months back: 20 € budget, 50 € spent there, so last month starts 30 € behind.
  await sql`
    insert into category_budgets (category_id, user_id, amount_cents, rollover, rollover_start)
    values (${roll.id}, ${workerUser.id}, 2000, true, ${`${monthAt(-2)}-01`})`;

  const current = monthAt(0);
  const previous = monthAt(-1);
  const twoBack = monthAt(-2);
  const rows: [string, string, number, string | null][] = [
    [`${current}-01`, "cur", -3000, spend.id],
    [`${previous}-05`, "prev", -8000, spend.id],
    [`${previous}-06`, "prevroll", -500, roll.id],
    [`${twoBack}-04`, "twoback", -5000, roll.id],
    [`${twoBack}-08`, "outside", -1234, null],
  ];
  for (const [date, key, amount, categoryId] of rows) {
    await sql`
      insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, category_id, category_source, dedupe_hash, occurrence_index)
      values (${workerUser.id}, ${account.id}, ${imp.id}, ${date}, ${amount}, ${PREFIX}, ${PREFIX.toLowerCase()}, ${PREFIX}, ${categoryId}, ${categoryId ? "manual" : null}, ${`bp${stamp}${key}`}, 0)`;
  }

  await page.setViewportSize({ width: 390, height: 844 });

  // The current month: title, month button, budgets as percentages, no "This month" link any more.
  await page.goto("/budget");
  await expect(page.getByRole("heading", { level: 1, name: "Plan" })).toBeVisible();
  await expect(page.getByTestId("month-picker-trigger")).toHaveText(new RegExp(label(current)));
  const budgets = page.getByTestId("plan-budgets");
  const spendRow = budgets.getByRole("link").filter({ hasText: spendName });
  await expect(spendRow).toContainText("60%");
  await expect(spendRow.locator("[data-pace]")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /^This month/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // The previous arrow: a finished month has no pace tick and says how the budgets ended.
  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(page).toHaveURL(new RegExp(`/budget\\?month=${previous}$`));
  await expect(page.getByTestId("month-picker-trigger")).toHaveText(new RegExp(label(previous)));
  await expect(spendRow).toContainText("160%");
  await expect(spendRow.locator("[data-pace]")).toHaveCount(0);
  await expect(page.getByTestId("budget-verdict")).toContainText("budgets kept");

  // A rollover deficit is told in words and never as "of -…".
  const rollRow = budgets.getByRole("link").filter({ hasText: rollName });
  await expect(rollRow).toContainText("carried over behind");
  await expect(rollRow).toContainText("100%");
  await expect(rollRow).not.toContainText("of -");
  await expect(budgets).not.toContainText("of -");

  // Tapping the month name opens the month grid: jump two months back in one gesture.
  await page.getByTestId("month-picker-trigger").click();
  const picker = page.getByRole("dialog", { name: "Choose a month" });
  await expect(picker.getByTestId("month-picker-cell")).toHaveCount(12);
  await picker.getByRole("link", { name: new RegExp(`^${label(twoBack)}, .* spent$`) }).click();
  await expect(page).toHaveURL(new RegExp(`month=${twoBack}$`));
  await expect(page.getByTestId("month-picker-trigger")).toHaveText(new RegExp(label(twoBack)));
  // Spending no budget covers is named inside the spent amount, so "over" is not a mystery.
  await expect(page.getByTestId("month-outside")).toHaveText("incl. €12.34 outside budgets");

  // A bar is a link to its month; the current month's bar goes back to the plain address.
  await page.getByTestId("budget-month-bars").getByRole("link", { name: new RegExp(`^${label(previous)}:`) }).click();
  await expect(page).toHaveURL(new RegExp(`month=${previous}$`));
  await page.getByTestId("budget-month-bars").getByRole("link", { name: new RegExp(`^${label(current)}:`) }).click();
  await expect(page).toHaveURL(/\/budget$/);

  // No red anywhere, on the month in progress and on a finished month.
  for (const url of ["/budget", `/budget?month=${previous}`]) {
    await page.goto(url);
    await expect(page.getByTestId("month-card")).toBeVisible();
    const reddish = await page.evaluate(() => {
      const isRed = (value: string) => {
        const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) return false;
        const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
        return a > 0 && r > 180 && g < 120 && b < 120;
      };
      const found: string[] = [];
      for (const el of document.querySelectorAll("main *")) {
        const style = getComputedStyle(el);
        if ([style.color, style.backgroundColor, style.borderTopColor].some(isRed)) found.push(el.tagName + "." + String(el.className).slice(0, 60));
      }
      return found;
    });
    expect(reddish, `red elements on ${url}`).toEqual([]);
  }
});

test("budget page: the old addresses are gone", async ({ page }) => {
  for (const path of ["/month", "/plan", "/plan/next-month"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});
