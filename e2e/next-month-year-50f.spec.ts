import { addMonths, currentMonth } from "../src/lib/dashboard/month";
import { formatSignedWholeCents } from "../src/lib/money";

import { expect, test } from "./fixtures";
import {
  csvFile,
  debitRow,
  creditRow,
  importFile,
  recentDate,
  undoImport,
} from "./helpers/recurring";

test.use({ viewport: { width: 390, height: 844 } });

const PREFIX = "E2E-NM";

test("next month: what's left counts the budgets, and the to-confirm row links to Regular payments", async ({
  page,
  sql,
  workerUser,
}) => {
  const stamp = Date.now();
  const salary = `${PREFIX}-SAL-${stamp}`;
  const gym = `${PREFIX}-GYM-${stamp}`;
  const file = csvFile(
    `${PREFIX}-${stamp}.csv`,
    [2, 1, 0].flatMap((ago) => [
      creditRow(recentDate(ago, 1), salary, "2000,00"),
      debitRow(recentDate(ago, 2), gym, "-40,00"),
    ]),
  );
  await importFile(page, file, 6);
  const [category] =
    await sql`insert into categories (user_id, name, color) values (${workerUser.id}, ${`${PREFIX}-CAT ${stamp}`}, '#2255aa') returning id`;

  try {
    await page.goto("/budget/next-month");
    const left = page.getByRole("region", { name: "What's left" });
    await expect(left).toBeVisible();
    const before = await left.getByTestId("next-month-left-amount").innerText();

    // The detected salary and gym wait for a confirmation: one row says so and leads to them.
    const toConfirm = page.getByRole("link", {
      name: /regular payments? to confirm/,
    });
    await expect(toConfirm).toHaveAttribute("href", "/recurring");
    const gymRow = page
      .getByRole("list", { name: "Expected payments" })
      .getByRole("listitem")
      .filter({ hasText: gym });
    await expect(gymRow).toContainText("to confirm");

    // A 300 € budget on a category nobody spends in lowers what's left by 300 €.
    await sql`insert into category_budgets (category_id, user_id, amount_cents) values (${category.id}, ${workerUser.id}, 30000)`;
    await page.reload();
    await expect(
      left.getByText(formatSignedWholeCents(-30000, "en")),
    ).toBeVisible();
    expect(
      await left.getByTestId("next-month-left-amount").innerText(),
    ).not.toBe(before);
  } finally {
    await sql`delete from category_budgets where category_id = ${category.id}`;
    await sql`delete from categories where id = ${category.id}`;
    await undoImport(page, file.name);
  }
});

test("every page is 50 F: no sideways scroll at 360 px, the bars and the not-found page wear the theme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ["/budget/next-month", "/year"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      path,
    ).toBe(true);
    await expect(
      page.getByRole("navigation", { name: /^Main/ }).first(),
    ).toHaveClass(/theme-50f/);
  }
  await page.goto("/does-not-exist");
  await expect(page.locator(".theme-50f").first()).toBeVisible();
});

test("year: months after the current one are disabled in the period sheet", async ({
  page,
}) => {
  test.skip(
    currentMonth(new Date()).endsWith("-12"),
    "December has no month after it",
  );
  const file = csvFile(`${PREFIX}-YEAR-${Date.now()}.csv`, [
    debitRow(recentDate(0, 1), `${PREFIX}-YR-${Date.now()}`, "-10,00"),
  ]);
  await importFile(page, file, 1);
  try {
    await page.goto("/year");
    await page.getByRole("button", { name: /Whole year/ }).click();
    const [y, m] = addMonths(currentMonth(new Date()), 1)
      .split("-")
      .map(Number);
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    await expect(
      page
        .getByRole("dialog", { name: "Period" })
        .getByRole("link", { name: label }),
    ).toHaveAttribute("aria-disabled", "true");
  } finally {
    await undoImport(page, file.name);
  }
});
