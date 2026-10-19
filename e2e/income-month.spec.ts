import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

// The setting is saved on the worker's user, so the test puts it back to the default.
async function choose(page: Page, label: string, body: string) {
  const saved = page.waitForResponse(
    (r) => r.request().headers()["next-action"] !== undefined && (r.request().postData() ?? "").includes(body),
  );
  await page.getByRole("radio", { name: new RegExp(`^${label}`) }).check();
  await saved;
}

test("income month: choosing 'the month it arrives' sticks, and the default is next month", async ({ page }) => {
  try {
    await page.goto("/settings");
    const row = page.getByRole("button", { name: /^Income/ });
    await expect(row).toContainText("For the next month");

    await row.click();
    const sheet = page.getByRole("dialog", { name: "Income" });
    await expect(sheet.getByRole("radio", { name: /^For the next month/ })).toBeChecked();
    await expect(sheet.getByText("Recommended")).toBeVisible();

    await choose(page, "For the month it arrives", '"this"');
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByRole("button", { name: /^Income/ })).toContainText("For the month it arrives");
  } finally {
    await page.goto("/settings");
    await page.getByRole("button", { name: /^Income/ }).click();
    if (!(await page.getByRole("radio", { name: /^For the next month/ }).isChecked())) await choose(page, "For the next month", '"next"');
  }
});
