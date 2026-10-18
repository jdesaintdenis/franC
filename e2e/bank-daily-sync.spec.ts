import { type Page } from "@playwright/test";

import { expect, test, waitForStreamedContent } from "./fixtures";
import { armRateLimit, deleteAccountById, deleteConnections, seedAccount, seedConnection } from "./helpers/bank-seed";
import { isoDaysAgo } from "./helpers/dates";
import { chooseLink, holdFirstSync, openConnectionMenu } from "./helpers/bank";
import { deleteAccount, deleteAccountsWithPrefix } from "./helpers/manage";

// Slice 49: the daily job, sync on open, connection health, Reconnect and the Import button rule.
// Runs against the fake Enable Banking server (e2e/helpers/fake-enable-banking.ts). Most tests seed
// the connection in SQL (e2e/helpers/bank-seed.ts); the Reconnect test goes through the fake bank.

const BANK = "Caisse d'Epargne Ile-de-France";
const stamp = Date.now();
const PHONE = { width: 390, height: 844 };
const rateLimitSentence = "Your bank's limit for today is reached. franC will try again tomorrow morning.";

const ownedAccounts: string[] = [];

test.afterEach(async ({ sql, workerUser, page }, testInfo) => {
  await deleteConnections(sql, workerUser.id);
  for (const id of ownedAccounts.splice(0)) await deleteAccountById(sql, id);
  if (testInfo.status !== testInfo.expectedStatus) await deleteAccountsWithPrefix(page, "Compte de cheques");
});

/** A franC account that a seeded connection feeds. */
async function ownAccount(sql: Parameters<typeof seedAccount>[0], userId: string, label: string): Promise<string> {
  const id = await seedAccount(sql, userId, `${label} ${stamp}`);
  ownedAccounts.push(id);
  return id;
}

async function transactionCount(sql: Parameters<typeof seedAccount>[0], accountId: string): Promise<number> {
  const [row] = await sql`select count(*)::int as n from transactions where account_id = ${accountId}`;
  return row.n;
}

/** Resolves when the page's next server action (Sync now, or sync on open) has answered. */
function nextServerAction(page: Page) {
  return page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined);
}

test.describe("Navigation bar", () => {
  test("every account sees the same five tabs, with or without a bank link", async ({ page, sql, workerUser }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/settings");
    const bar = page.getByRole("navigation", { name: "Main" });
    await expect(bar.getByRole("link")).toHaveText(["Home", "Transactions", "Plan", "Accounts", "More"]);
    await expect(bar.getByRole("link", { name: "Import a bank export" })).toHaveCount(0);

    const [main] = await sql`select id from accounts where user_id = ${workerUser.id} order by created_at limit 1`;
    await seedConnection(sql, workerUser.id, [main.id]);
    await page.goto("/settings");
    await expect(bar.getByRole("link")).toHaveText(["Home", "Transactions", "Plan", "Accounts", "More"]);

    // A manual account changes nothing in the bar.
    const manual = await ownAccount(sql, workerUser.id, "Manual");
    await page.goto("/settings");
    await expect(bar.getByRole("link")).toHaveCount(5);
    await deleteAccountById(sql, manual);
    ownedAccounts.length = 0;
  });

  test("the desktop sidebar has the same five entries", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/settings");
    const sidebar = page.getByRole("navigation", { name: "Main" });
    await expect(sidebar.getByRole("list").getByRole("link")).toHaveText(["Home", "Transactions", "Plan", "Accounts", "More"]);
    // The review badge stays on Transactions whatever the bar looks like (covered by e2e/review.spec.ts).
  });
});

test.describe("Daily sync and sync on open", () => {
  test("the cron endpoint brings rows in, and Home says when it synced", async ({ page, request, sql, workerUser }) => {
    const account = await ownAccount(sql, workerUser.id, "Daily");
    await seedConnection(sql, workerUser.id, [account], { lastSyncedAgo: "1 day" });

    // No token, wrong token, right token.
    expect((await request.get("/api/cron/daily", { failOnStatusCode: false })).status()).toBe(401);
    const wrong = await request.get("/api/cron/daily", { headers: { authorization: "Bearer nope" }, failOnStatusCode: false });
    expect(wrong.status()).toBe(401);
    const run = await request.get("/api/cron/daily", { headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` } });
    expect(run.ok()).toBe(true);
    // The worker's account got the fake bank's three booked rows (other workers' links may add more).
    expect(await transactionCount(sql, account)).toBe(3);

    await page.goto("/");
    const line = page.getByTestId("sync-line");
    await expect(line).toContainText(/^Synced at \d\d:\d\d/);
    await expect(line.getByRole("button", { name: "Sync now" })).toBeVisible();
  });

  test("sync on open: a link last synced 3 hours ago syncs when Home opens, one synced 10 minutes ago doesn't", async ({
    page,
    sql,
    workerUser,
  }) => {
    const account = await ownAccount(sql, workerUser.id, "Open");
    const { links } = await seedConnection(sql, workerUser.id, [account], { lastSyncedAgo: "3 hours" });

    const stale = nextServerAction(page);
    await page.goto("/");
    await stale;
    await expect.poll(() => transactionCount(sql, account)).toBe(3);
    const [after] = await sql`select now() - last_synced_at < interval '1 minute' as fresh from bank_account_links where id = ${links[0].linkId}`;
    expect(after.fresh).toBe(true);

    // Fresh data: opening again makes the call, and the server declines to sync.
    await sql`update bank_account_links set last_synced_at = now() - interval '10 minutes' where id = ${links[0].linkId}`;
    await sql`delete from transactions where account_id = ${account}`;
    const fresh = nextServerAction(page);
    await page.goto("/");
    await fresh;
    expect(await transactionCount(sql, account)).toBe(0);
    const [still] = await sql`select now() - last_synced_at > interval '9 minutes' as untouched from bank_account_links where id = ${links[0].linkId}`;
    expect(still.untouched).toBe(true);

    // A link never synced waits for its first Sync now (the start date is still changeable).
    await sql`update bank_account_links set last_synced_at = null where id = ${links[0].linkId}`;
    const never = nextServerAction(page);
    await page.goto("/");
    await never;
    expect(await transactionCount(sql, account)).toBe(0);
  });

  test("the bank's daily limit shows as a sentence on Sync now and on the status lines, not as a failure", async ({
    page,
    sql,
    workerUser,
  }) => {
    const account = await ownAccount(sql, workerUser.id, "Limit");
    const { links } = await seedConnection(sql, workerUser.id, [account], { lastSyncedAgo: "10 minutes" });
    await armRateLimit(links[0].uid);

    await page.goto("/accounts/bank");
    const card = page.getByTestId("bank-connection");
    await expect(card.getByTestId("connection-status")).toContainText("Synced 10 min");
    await card.getByRole("button", { name: "Sync now" }).click();
    await expect(card.getByRole("alert")).toHaveText(rateLimitSentence);
    await page.reload();
    await expect(card.getByTestId("connection-status")).toHaveText(rateLimitSentence);

    await page.goto("/");
    await expect(page.getByTestId("sync-line")).toContainText(rateLimitSentence);
    // Not a failure: no row in Needs attention.
    await expect(page.getByTestId("attention-bank-failing")).toHaveCount(0);
    await expect(page.getByTestId("attention-bank-reconnect")).toHaveCount(0);

    // The limit was one-off: Home's Sync now brings the rows in and says so in a toast.
    await page.getByTestId("sync-line").getByRole("button", { name: "Sync now" }).click();
    const toast = page.getByRole("status").filter({ hasText: "3 new transactions" });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("button", { name: "Review now" })).toBeVisible();
    await expect(page.getByTestId("sync-line")).toContainText(/^Synced at \d\d:\d\d/);
  });

  test("a failing bank shows from the first failure on Home and the connection", async ({ page, sql, workerUser }) => {
    const account = await ownAccount(sql, workerUser.id, "Failing");
    const { links } = await seedConnection(sql, workerUser.id, [account], { lastSyncedAgo: "10 minutes" });
    await sql`update bank_account_links set last_error = 'bank_unavailable', failing_since = now() - interval '1 day', last_attempt_at = now() where id = ${links[0].linkId}`;

    await page.goto("/");
    await expect(page.getByTestId("attention-bank-failing")).toContainText("Sync failing since");
    await expect(page.getByTestId("sync-line")).toContainText("Sync failing since");
    await page.goto("/accounts/bank");
    await expect(page.getByTestId("connection-status")).toContainText("Sync failed · since");
    await expect(page.getByRole("link", { name: "Reconnect" })).toHaveCount(0);
  });

  test("the import reminder ignores an account a bank feeds", async ({ page, sql, workerUser }) => {
    const name = `Reminder ${stamp}`;
    const account = await seedAccount(sql, workerUser.id, name);
    ownedAccounts.push(account);
    const [imp] = await sql`
      insert into imports (user_id, account_id, filename, uploaded_at)
      values (${workerUser.id}, ${account}, 'old.csv', now() - interval '20 days') returning id`;
    await sql`
      insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, dedupe_hash, occurrence_index)
      values (${workerUser.id}, ${account}, ${imp.id}, ${isoDaysAgo(20)}, -1234, ${name}, ${name}, ${name}, ${`rem${stamp}`}, 0)`;

    await page.goto("/");
    const reminder = page.getByTestId("attention-stale-import").filter({ hasText: name });
    await expect(reminder).toHaveCount(1);

    await seedConnection(sql, workerUser.id, [account], { lastSyncedAgo: "10 minutes" });
    await page.goto("/");
    await expect(reminder).toHaveCount(0);
    await expect(page.getByTestId("sync-line")).toBeVisible();
  });
});

test("Reconnect keeps the account links, and Home asks for it before the consent runs out", async ({ page, sql, workerUser }) => {
  // The connect flow twice, a sync and several page loads: longer than the default.
  test.slow();
  const accountName = "Compte de cheques";

  await page.goto("/accounts/bank");
  await page.getByRole("button", { name: "Choose my bank", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Your bank" });
  await sheet.getByLabel("Search banks").fill("ile-de");
  await sheet.getByRole("list", { name: "Banks" }).getByRole("link").first().click();
  await page.getByRole("link", { name: "Approve" }).click();
  await expect(page).toHaveURL(/\/accounts\/bank\?connected=1/);
  await waitForStreamedContent(page);
  const card = page.getByTestId("bank-connection");
  await chooseLink(card, /Compte de cheques/, `New account “${accountName}”`);
  await chooseLink(card, /Livret A/, "Don't import");
  await holdFirstSync(page);
  await card.getByRole("button", { name: "Save" }).click();
  await card.getByRole("button", { name: "Sync now" }).click();
  await expect(card.getByTestId("sync-result")).toContainText("3 new transactions");
  await expect(card.getByTestId("connection-status")).toContainText("Synced");
  const [before] = await sql`
    select l.id, l.account_id, l.identification_hash from bank_account_links l
    join bank_connections c on c.id = l.connection_id where c.user_id = ${workerUser.id} and l.account_id is not null`;
  expect(before.identification_hash).not.toBeNull();

  // The consent ends in 10 days: Home asks, the connection says so, and Reconnect is offered.
  await sql`update bank_connections set valid_until = now() + interval '10 days' where user_id = ${workerUser.id}`;
  await page.goto("/");
  await expect(page.getByTestId("attention-bank-reconnect")).toContainText("Reconnect your bank (expires");
  await expect(page.getByTestId("sync-line")).toContainText("Reconnect your bank");
  await page.goto("/accounts/bank");
  await expect(card.getByTestId("connection-status")).toContainText("Reconnect needed · ends");
  await card.getByRole("link", { name: "Reconnect" }).click();
  await expect(page).toHaveTitle("Fake bank");
  await page.getByRole("link", { name: "Approve" }).click();

  // Back, with the same links on the same franC account: no second connection, no link step.
  await expect(page).toHaveURL(/\/accounts\/bank\?reconnected=1/);
  await waitForStreamedContent(page);
  await expect(page.getByRole("status").filter({ hasText: "Bank reconnected" })).toBeVisible();
  await expect(page.getByTestId("bank-connection")).toHaveCount(1);
  await expect(card.getByRole("heading", { name: BANK })).toBeVisible();
  await expect(card.getByRole("link", { name: "Reconnect" })).toHaveCount(0);
  await expect(card.getByTestId("connection-status")).toContainText("Synced");
  const links = card.getByRole("list", { name: "Bank accounts and the franC accounts they feed" });
  await expect(links.getByRole("listitem")).toHaveText([/Compte de cheques.*Compte de cheques ••1234/, /Not imported.*Livret A ••5678/]);
  const [after] = await sql`
    select l.id, l.account_id from bank_account_links l
    join bank_connections c on c.id = l.connection_id where c.user_id = ${workerUser.id} and l.account_id is not null`;
  expect(after.account_id).toBe(before.account_id);
  const [until] = await sql`select valid_until > now() + interval '60 days' as renewed from bank_connections where user_id = ${workerUser.id}`;
  expect(until.renewed).toBe(true);

  // It syncs into the same account without counting anything twice.
  await card.getByRole("button", { name: "Sync now" }).click();
  await expect(card.getByTestId("sync-result")).toContainText("Nothing new");
  await page.goto("/");
  await expect(page.getByTestId("attention-bank-reconnect")).toHaveCount(0);

  await page.goto("/accounts/bank");
  await openConnectionMenu(card, BANK);
  await page.getByRole("menuitem", { name: "Disconnect bank" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Link your bank" })).toBeVisible();
  await page.goto("/accounts");
  await deleteAccount(page, accountName);
});
