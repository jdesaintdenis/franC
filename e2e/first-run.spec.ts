import { readFileSync } from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import postgres from "postgres";

import { expect, test } from "./fixtures";
import { openStartingBalance } from "./helpers/manage";

// A brand-new user, so the app starts empty. The address must be in ALLOWED_EMAILS.
dotenv.config({ path: path.join(__dirname, "..", ".env.local"), quiet: true });

test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = process.env.E2E_NEW_USER_EMAIL ?? "e2e-new@example.com";
const PASSWORD = "e2e-new-password-123";
const SAMPLE = readFileSync(path.join(__dirname, "..", "docs", "samples", "sample-export.csv"));

const sql = postgres(process.env.DATABASE_URL ?? "");

// Everything the user owns cascades from the users row.
async function deleteUser() {
  await sql`delete from users where email = ${EMAIL}`;
}

test.beforeAll(deleteUser);
test.afterAll(async () => {
  await deleteUser();
  await sql.end();
});

test("first run: from an empty app to a useful Home through the checklist", async ({ page, request, baseURL }) => {
  const signUp = await request.post(`${baseURL}/api/auth/sign-up/email`, {
    data: { email: EMAIL, password: PASSWORD, name: "New User" },
  });
  expect(signUp.ok(), `sign-up failed: is ${EMAIL} in ALLOWED_EMAILS?`).toBe(true);

  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("/");

  // Empty Home: the checklist is the page, the import step is next.
  const checklist = page.getByTestId("welcome-checklist");
  await expect(checklist).toBeVisible();
  await expect(page.getByTestId("welcome-intro")).toBeVisible();
  await expect(checklist.getByText("0 of 4")).toBeVisible();
  await expect(page.getByTestId("welcome-step-import")).toHaveAttribute("aria-current", "step");

  // 1. Import: choosing the file previews at once, summary first, categories set to create.
  await page.getByTestId("welcome-step-import").click();
  await page.waitForURL("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({ name: "export.csv", mimeType: "text/csv", buffer: SAMPLE });
  const preview = page.getByRole("region", { name: "Import preview" });
  await expect(preview.getByTestId("import-new-count")).toBeVisible();
  await expect(preview.getByTestId("import-flows")).toBeVisible();
  await expect(preview.getByText(/will be created in your categories/)).toBeVisible();
  // The first rows show at once (Slice 62).
  await expect(preview.getByRole("list", { name: "New transactions" })).toBeVisible();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();

  // After a first import: one button, with Undo.
  const result = page.getByRole("region", { name: "Import result" });
  await expect(result.getByText(/transactions imported/)).toBeVisible();
  await expect(result.getByRole("link", { name: "Review one by one" })).toBeVisible();
  await result.getByRole("button", { name: "Validate all" }).click();
  await expect(result.getByTestId("bulk-outcome")).toBeVisible();
  await page.getByRole("button", { name: /^Undo: / }).click();
  await expect(result.getByRole("button", { name: "Validate all" })).toBeVisible();
  await result.getByRole("button", { name: "Validate all" }).click();
  await expect(result.getByTestId("bulk-outcome")).toBeVisible();
  // Rows nothing could categorize wait in the queue: mark them so step 2 ticks.
  if (await result.getByRole("link", { name: "Review them" }).isVisible()) {
    // A new user has no categories yet, and Mark all leaves rows without one (SPEC §73 A): mark them in the database.
    await sql`update transactions set reviewed_at = now() where user_id = (select id from users where email = ${EMAIL}) and reviewed_at is null`;
    await page.goto("/review");
    await expect(page.getByText("All caught up")).toBeVisible();
  }

  await page.goto("/");
  await expect(page.getByTestId("welcome-step-import")).toHaveAttribute("data-done", "true");
  await expect(page.getByTestId("welcome-step-review")).toHaveAttribute("data-done", "true");
  await expect(page.getByTestId("welcome-step-balance")).toHaveAttribute("aria-current", "step");

  // 3. Balance.
  await page.getByTestId("welcome-step-balance").click();
  await page.waitForURL("/accounts");
  const optionsLabel = await page.getByRole("button", { name: /^Options for / }).first().getAttribute("aria-label");
  const sheet0 = await openStartingBalance(page, (optionsLabel ?? "").replace(/^Options for /, ""));
  await sheet0.getByLabel("Balance", { exact: true }).fill("1 500");
  await sheet0.getByRole("button", { name: "Save balance" }).click();
  await expect(sheet0).toBeHidden();
  await expect(page.getByRole("list", { name: "Your accounts" }).getByRole("listitem").first().getByText(/€/)).toBeVisible();

  // 4. A first budget.
  await page.goto("/");
  await expect(page.getByTestId("welcome-step-budget")).toHaveAttribute("aria-current", "step");
  await page.getByTestId("welcome-step-budget").click();
  // The checklist opens the "Add a budget" sheet; the first suggestion gets 200 a month.
  await page.waitForURL("/settings/budgets?add=1");
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("list", { name: "Categories without a budget" }).getByRole("button").first().click();
  await sheet.getByLabel("Monthly budget").fill("200");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Budget saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Budgets by category" }).getByRole("listitem")).toHaveCount(1);

  // A useful Home, and the checklist is gone for good.
  await page.goto("/");
  await expect(page.getByTestId("welcome-checklist")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("welcome-checklist")).toHaveCount(0);
});
