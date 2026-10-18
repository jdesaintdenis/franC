import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { manageSheet, rowMenuAction } from "./helpers/manage";

// Aging data needs the database: an import made through the UI always counts as today.
const stamp = Date.now();
const ACCOUNT = `ZQReminder${stamp}`;

let accountId = "";

test.beforeAll(async ({ sql, workerUser: user }) => {
  const [account] = await sql`insert into accounts (user_id, name) values (${user.id}, ${ACCOUNT}) returning id`;
  accountId = account.id;
  const [imp] = await sql`
    insert into imports (user_id, account_id, filename, uploaded_at)
    values (${user.id}, ${accountId}, 'reminder.csv', now() - interval '20 days') returning id`;
  await sql`
    insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, dedupe_hash, occurrence_index)
    values (${user.id}, ${accountId}, ${imp.id}, (now() - interval '20 days')::date, -1234, ${ACCOUNT}, ${ACCOUNT}, ${ACCOUNT}, ${`zqrem${stamp}`}, 0)`;
  // Any recurring item makes the Next month page render its forecast.
  await sql`
    insert into recurring (user_id, account_id, merchant_key, typical_amount_cents, interval, last_seen_date, next_expected_date, status)
    values (${user.id}, ${accountId}, ${ACCOUNT}, -1234, 'monthly', (now() - interval '20 days')::date, (now() + interval '10 days')::date, 'confirmed')`;
});

test.afterAll(async ({ sql }) => {
  // transactions and imports cascade from the account.
  await sql`delete from accounts where id = ${accountId}`;
});

// The worker's E2E user must end up with the default reminder.
test.afterEach(async ({ page }) => {
  await setDays(page, "14");
});

async function setDays(page: Page, days: string) {
  await page.goto("/accounts");
  const toggle = page.getByLabel("Remind me to import");
  if (!(await toggle.isChecked())) await toggle.check();
  const input = page.getByLabel("After");
  await expect(input).toBeEnabled();
  await input.fill(days);
  await input.blur();
  await expect(input).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("After")).toHaveValue(days);
}

test("import reminder: banner with a preselecting Import link, gone with a longer threshold", async ({ page }) => {
  await page.goto("/");
  // A row in Needs attention, the whole row a link to Import with the account preselected.
  const row = page.getByTestId("attention-stale-import");
  await expect(row).toContainText(`No new data for ${ACCOUNT} since`);
  await expect(row).toContainText("20 days");

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/import\\?account=${accountId}`));
  await expect(page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name: ACCOUNT })).toHaveAttribute("aria-checked", "true");

  await setDays(page, "30");
  await page.goto("/");
  await expect(page.getByTestId("attention-stale-import")).toBeHidden();
});

test("import reminder: per-account opt-out hides the banner", async ({ page }) => {
  const setReminder = async (on: boolean) => {
    await page.goto("/accounts");
    await rowMenuAction(page, ACCOUNT, "Edit");
    const sheet = manageSheet(page);
    const box = sheet.getByLabel("Remind me to import");
    await box.setChecked(on);
    await expect(box).toBeEnabled();
    await expect(box).toBeChecked({ checked: on });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  };
  try {
    await setReminder(false);
    await page.goto("/");
    await expect(page.getByTestId("attention-stale-import")).toBeHidden();
  } finally {
    await setReminder(true);
  }
});

test("import reminder: 'Data up to' on the dashboard and 'Based on data up to' on Next month", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("data-up-to")).toContainText("Data up to");

  await page.goto(`/budget`);
  await expect(page.getByTestId("data-up-to")).toContainText(/Data up to \d{1,2} [A-Z][a-z]{2,4}( \d{4})?/);

  await page.goto(`/budget/next-month`);
  await expect(page.getByRole("heading", { level: 2, name: "What's left" })).toBeVisible();
  await expect(page.getByText(/Based on data up to \d{1,2} [A-Z][a-z]{2,4}( \d{4})?/)).toBeVisible();
});

test("import reminder: dashboard has no serious a11y violations with the banner", async ({ page }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.getByTestId("attention-stale-import")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
});
