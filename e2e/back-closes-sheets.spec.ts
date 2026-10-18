import { expect, test } from "./fixtures";
import { deleteAccountById, seedAccount } from "./helpers/bank-seed";

const stamp = Date.now();

// The phone's Back closes an open sheet instead of leaving the page; closing it otherwise leaves no extra Back step.

test("Back closes the account sheet and stays on Accounts", async ({ page, sql, workerUser }) => {
  const name = `ZQBack${stamp}`;
  const id = await seedAccount(sql, workerUser.id, name);
  try {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Accounts" }).click();
    await expect(page).toHaveURL("/accounts");
    const row = page.getByRole("list", { name: "Your accounts" }).getByRole("listitem").filter({ hasText: name });
    const sheet = page.getByRole("dialog", { name });

    await row.getByRole("button").first().click();
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL("/accounts");

    // Closed with ✕: the next Back leaves the page at once.
    await row.getByRole("button").first().click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL("/accounts");
    await page.goBack();
    await expect(page).toHaveURL("/");
  } finally {
    await deleteAccountById(sql, id);
  }
});

test("Back closes the month picker, a sheet without an address", async ({ page }) => {
  await page.goto("/");
  await page.goto("/budget");
  await page.getByTestId("month-picker-trigger").click();
  const picker = page.getByTestId("month-picker");
  await expect(picker).toBeVisible();
  await page.goBack();
  await expect(picker).toBeHidden();
  await expect(page).toHaveURL("/budget");
  await page.goBack();
  await expect(page).toHaveURL("/");
});
