import { expect, test } from "./fixtures";
import { toastWith } from "./helpers/sheet";
import { anyRow, csvFile, debitRow, importFile, recentDate, settled, sheetAction, showToConfirmList, undoImport } from "./helpers/recurring";

async function runningAnimations(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
}

async function importBill(page: import("@playwright/test").Page, name: string) {
  const file = csvFile(`mo-${Date.now()}.csv`, [
    debitRow(recentDate(2, 4), name, "-5,00"),
    debitRow(recentDate(1, 4), name, "-5,00"),
    debitRow(recentDate(0, 4), name, "-5,00"),
  ]);
  await importFile(page, file, 3);
  return file;
}

test.describe("with motion on", () => {
  test.use({ reducedMotion: "no-preference" });

  test("a regular payment leaves with a transition and Undo brings it back", async ({ page }) => {
    const name = `E2E-MOT-${Date.now()}`;
    const file = await importBill(page, name);
    try {
      await page.goto("/recurring");
      await showToConfirmList(page);
      await expect(anyRow(page, name)).toHaveCount(1);
      await anyRow(page, name).getByRole("button").first().click();
      await sheetAction(page, name, "Dismiss").click();
      await expect(anyRow(page, name)).toHaveCount(0);
      await settled(page, () => toastWith(page, `${name} dismissed`).getByRole("button", { name: /^Undo/ }).click());
      await showToConfirmList(page);
      await expect(anyRow(page, name)).toHaveCount(1);
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
    } finally {
      await undoImport(page, file.name);
    }
  });
});

test("with reduced motion an opened sheet runs no animation", async ({ page }) => {
  const name = `E2E-RMO-${Date.now()}`;
  const file = await importBill(page, name);
  try {
    await page.goto("/recurring");
    await showToConfirmList(page);
    await anyRow(page, name).getByRole("button").first().click();
    const sheet = page.locator("[data-slot=sheet-content]");
    await expect(sheet).toBeVisible();
    await expect.poll(() => runningAnimations(page)).toBe(0);
    const duration = await sheet.evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThanOrEqual(0.01);
  } finally {
    await page.keyboard.press("Escape");
    await undoImport(page, file.name);
  }
});
