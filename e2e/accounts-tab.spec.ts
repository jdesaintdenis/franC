import { expect, test } from "./fixtures";
import { deleteAccountById, deleteConnections, seedAccount, seedConnection } from "./helpers/bank-seed";

const stamp = Date.now();

// Slice 61: Accounts is a tab; Plus lost accounts, bank sync and imports; Home lost its accounts card.

test("the Accounts tab has the accounts, the imports entry and the reminder switch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL("/accounts");
  await expect(page.getByRole("heading", { level: 1, name: "Accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your accounts" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "New account" })).toBeVisible();

  const imports = page.getByTestId("imports-section");
  await imports.getByRole("link", { name: /^Import a CSV/ }).click();
  await expect(page).toHaveURL("/import");
  await page.getByRole("link", { name: "Back to Accounts" }).click();
  await expect(page).toHaveURL("/accounts");
  await expect(imports.getByRole("switch", { name: "Remind me to import" })).toBeVisible();
});

test("Plus has no accounts, bank connection or import row, and the old addresses are gone", async ({ page, request }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "More" })).toBeVisible();
  for (const name of [/^Accounts/, /^Bank connection/, /^Import a CSV/]) {
    await expect(page.getByRole("main").getByRole("link", { name })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  for (const path of ["/settings/accounts", "/settings/bank-connection"]) {
    expect((await request.get(path, { failOnStatusCode: false })).status()).toBe(404);
  }
});

test("Home no longer lists the accounts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Accounts", exact: true })).toHaveCount(0);
});

test("the total card splits current and savings, and an account without a balance offers to add one", async ({ page, sql, workerUser }) => {
  const current = await seedAccount(sql, workerUser.id, `ZQCurrent${stamp}`);
  const savings = await seedAccount(sql, workerUser.id, `ZQSavings${stamp}`);
  const bare = await seedAccount(sql, workerUser.id, `ZQBare${stamp}`);
  try {
    await sql`update accounts set savings = true where id = ${savings}`;
    await sql`
      insert into balance_checkpoints (user_id, account_id, date, amount_cents, source)
      values (${workerUser.id}, ${current}, '2015-01-01', 100000, 'manual'), (${workerUser.id}, ${savings}, '2015-01-01', 50000, 'manual')`;
    await page.goto("/accounts");
    const total = page.getByTestId("accounts-total");
    await expect(total).toBeVisible();
    await expect(total).toContainText(/Current .*Savings /);
    const rows = page.getByRole("list", { name: "Your accounts" }).getByRole("listitem");
    await expect(rows.filter({ hasText: `ZQSavings${stamp}` })).toContainText("500.00");
    await expect(rows.filter({ hasText: `ZQCurrent${stamp}` })).toContainText("1,000.00");

    const row = rows.filter({ hasText: `ZQBare${stamp}` });
    await row.getByText("Add a balance").click();
    await expect(page.getByRole("dialog", { name: `ZQBare${stamp}` })).toBeVisible();
  } finally {
    for (const id of [current, savings, bare]) await deleteAccountById(sql, id);
  }
});

test("an account overdue for an import shows an amber line with an Import link that preselects it", async ({ page, sql, workerUser }) => {
  const name = `ZQStale${stamp}`;
  const id = await seedAccount(sql, workerUser.id, name);
  try {
    const [imp] = await sql`
      insert into imports (user_id, account_id, filename, uploaded_at)
      values (${workerUser.id}, ${id}, 'stale.csv', now() - interval '40 days') returning id`;
    await sql`
      insert into transactions (user_id, account_id, import_id, date, amount_cents, label_raw, label_normalized, label_display, dedupe_hash, occurrence_index)
      values (${workerUser.id}, ${id}, ${imp.id}, (now() - interval '40 days')::date, -500, ${name}, ${name}, ${name}, ${`zqstale${stamp}`}, 0)`;
    await page.goto("/accounts");
    const line = page.getByTestId("stale-account").filter({ hasText: name });
    await expect(line).toContainText("nothing new for 40 days");
    await line.getByRole("link", { name: "Import" }).click();
    await expect(page).toHaveURL(new RegExp(`/import\\?account=${id}`));
    await expect(page.getByRole("radiogroup", { name: "Which account" }).getByRole("radio", { name })).toHaveAttribute("aria-checked", "true");
  } finally {
    await deleteAccountById(sql, id);
  }
});

test("a bank connection shows in Bank sync with a working Sync now", { tag: "@bank" }, async ({ page, sql, workerUser }) => {
  const id = await seedAccount(sql, workerUser.id, `ZQFed${stamp}`);
  try {
    await seedConnection(sql, workerUser.id, [id]);
    await page.goto("/accounts");
    const card = page.getByTestId("bank-sync-section");
    await expect(card).toContainText("Mock ASPSP");
    await expect(card).toContainText("connection valid until");
    await card.getByRole("button", { name: "Sync now" }).click();
    await expect(card.getByTestId("sync-result")).toBeVisible();
    await expect(page.getByRole("list", { name: "Your accounts" }).getByText(/^Mock ASPSP · /)).not.toHaveCount(0);
  } finally {
    await deleteConnections(sql, workerUser.id);
    await deleteAccountById(sql, id);
  }
});
