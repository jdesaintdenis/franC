import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";

import { expect, signIn, test, waitForStreamedContent, workerEmail } from "./fixtures";
import { chooseLink, disconnectAllBanks, holdFirstSync, openConnectionMenu } from "./helpers/bank";
import { undoImport } from "./helpers/imports";
import { deleteAccountsWithPrefix } from "./helpers/manage";

// Slice 62: the import preview shows money, the result keeps its button on screen, the bank page asks one date.

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";
const BANK = "Caisse d'Epargne Ile-de-France";

const debitRow = (date: string, label: string, debit: string) =>
  `${date};${label};PRLV ${label};REF1;REF1-;Prelevement;;;${debit};;${date};${date};0`;
const creditRow = (date: string, label: string, credit: string) =>
  `${date};${label};VIR ${label};REF2;REF2-;Virement;;;;${credit};${date};${date};0`;
const csv = (rows: string[]) => ({ mimeType: "text/csv", buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8") });

test("import: the preview shows money in, out and net; a file with nothing new offers another file", async ({ page }) => {
  const stamp = Date.now();
  const label = `E2E-FLOW-${stamp}`;
  const name = `flow-${stamp}.csv`;
  const file = { name, ...csv([creditRow("10/09/2025", label, "100,00"), debitRow("11/09/2025", `${label}-A`, "-20,00"), debitRow("12/09/2025", `${label}-B`, "-5,50")]) };
  const preview = page.getByRole("region", { name: "Import preview" });

  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles(file);
  await expect(preview.getByTestId("import-new-count")).toHaveText("3");
  const flows = preview.getByTestId("import-flows");
  await expect(flows).toContainText("100.00");
  await expect(flows).toContainText("25.50");
  await expect(flows).toContainText("74.50");
  await expect(preview.getByText(/already in franC/)).toHaveCount(0);
  await expect(preview.getByText(/unreadable/)).toHaveCount(0);

  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(page.getByRole("region", { name: "Import result" })).toBeVisible();

  // The same file again: nothing to record.
  await page.getByRole("button", { name: "Import another file" }).click();
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles(file);
  await expect(preview.getByText("Nothing new")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import \d+/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose another file" })).toBeVisible();
  await page.getByRole("button", { name: "Choose another file" }).click();

  // History: the menu holds Undo import, and undoing removes the row.
  const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: `Options for ${name}` }).click();
  await expect(page.getByRole("menuitem", { name: "Undo import" })).toBeVisible();
  await page.keyboard.press("Escape");
  await undoImport(page, name);
  await expect(row).toHaveCount(0);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("import: Validate all fits the screen after a big import", async ({ page }) => {
    const stamp = Date.now();
    const name = `big-${stamp}.csv`;
    const rows = Array.from({ length: 50 }, (_, i) => debitRow("15/09/2025", `E2E-BIG-${stamp}-${i}`, "-1,00"));
    await page.goto("/import");
    await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({ name, ...csv(rows) });
    await page.getByRole("button", { name: "Import 50 transactions" }).click();
    const button = page.getByRole("region", { name: "Import result" }).getByRole("button", { name: /Validate all/ });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    expect(box && box.width).toBeLessThanOrEqual(390 - 32);
    await undoImport(page, name);
  });
});

test("bank: one start date for the connection, then the menu holds Change links and Disconnect bank", { tag: "@bank" }, async ({ page }) => {
  test.slow();
  try {
    await page.goto("/accounts/bank");
    await page.getByRole("button", { name: "Choose my bank", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Your bank" });
    await sheet.getByLabel("Search banks").fill("ile-de");
    await sheet.getByRole("list", { name: "Banks" }).getByRole("link").first().click();
    await expect(page).toHaveTitle("Fake bank");
    await page.getByRole("link", { name: "Approve" }).click();
    await expect(page).toHaveURL(/\/accounts\/bank\?connected=1/);
    await waitForStreamedContent(page);

    const card = page.getByTestId("bank-connection");
    await expect(card.getByLabel("Bring transactions from")).toHaveCount(1);
    await chooseLink(card, /Livret A/, "Don't import");
    // The first sync would leave unreviewed rows in Main account for later specs on this worker.
    await holdFirstSync(page);
    await card.getByRole("button", { name: "Save and sync" }).click();
    await expect(page.getByText("Bank connected")).toBeVisible();

    await openConnectionMenu(card, BANK);
    await expect(page.getByRole("menuitem", { name: "Change links" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Disconnect bank" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Disconnect bank" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("heading", { name: "Link your bank" })).toBeVisible();
  } finally {
    await page.goto("/accounts/bank");
    await disconnectAllBanks(page);
    await deleteAccountsWithPrefix(page, "Livret A");
  }
});

test.describe("first run with a bank", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("home offers the bank first to a user who may sync", { tag: "@bank" }, async ({ page, baseURL, sql }) => {
    // The test server's BANK_SYNC_EMAILS lists w0..w15; w15 is free unless 16 workers run.
    test.skip(Number(process.env.PW_WORKERS ?? "4") > 15, "all allowed addresses are worker users");
    const email = workerEmail(15);
    const password = "e2e-first-bank-123";
    const id = randomUUID();
    await sql.begin(async (tx) => {
      await tx`delete from users where email = ${email}`;
      await tx`insert into users (id, name, email, email_verified) values (${id}, 'E2E Bank First', ${email}, false)`;
      await tx`insert into auth_accounts (id, account_id, provider_id, user_id, password, updated_at)
        values (${randomUUID()}, ${id}, 'credential', ${id}, ${await hashPassword(password)}, now())`;
      await tx`insert into accounts (user_id, name) values (${id}, 'Main account')`;
    });
    try {
      await signIn(page.context().request, baseURL ?? "", { id, email, password });
      await page.goto("/");
      await expect(page.getByTestId("welcome-step-bank")).toHaveAttribute("aria-current", "step");
      await expect(page.getByTestId("welcome-step-import")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "or import a CSV statement" })).toHaveAttribute("href", "/import");
    } finally {
      await sql`delete from users where email = ${email}`;
    }
  });
});
