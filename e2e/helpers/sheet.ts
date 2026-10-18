import { expect, type Locator, type Page } from "@playwright/test";

/** The open transaction detail sheet. */
export function sheetOf(page: Page): Locator {
  return page.getByTestId("transaction-sheet");
}

/** Closes the open sheet (Escape backs out of a step first, so call it from the main view). */
export async function closeSheet(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(sheetOf(page)).toBeHidden();
}

/**
 * Opens `row` (a transaction row button), picks `categoryName` in the category step and
 * closes the sheet. The sheet saves on its own, so there is nothing to confirm.
 */
export async function setCategoryInSheet(
  page: Page,
  row: Locator,
  categoryName: string,
): Promise<void> {
  await row.click();
  const sheet = sheetOf(page);
  await sheet.getByTestId("sheet-category").click();
  await sheet
    .getByTestId("category-picker")
    .getByRole("button", { name: categoryName, exact: true })
    .click();
  await expect(sheet.getByTestId("sheet-step")).toBeHidden();
  await expect(sheet.getByTestId("sheet-category")).toHaveAccessibleName(
    new RegExp(
      `^Category: .*${categoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    ),
  );
  await closeSheet(page);
}

/**
 * The toast showing `text` (the layout and an open sheet each render live regions): successes
 * are in a `status` region, errors in an `alert` one.
 */
export function toastWith(page: Page, text: string | RegExp): Locator {
  return page.locator('[role="status"], [role="alert"]').filter({ hasText: text });
}

/** Review page and swipe picker: opens the category picker sheet behind `trigger` and taps a category. */
export async function pickCategory(
  page: Page,
  trigger: Locator,
  categoryName: string,
): Promise<void> {
  await trigger.click();
  await page
    .getByTestId("category-picker")
    .getByRole("button", { name: categoryName, exact: true })
    .click();
}

/**
 * The review card's category row. `:visible` because a dev-mode Suspense stream can leave a
 * hidden copy of the card in the DOM.
 */
export function reviewCategory(page: Page): Locator {
  return page.locator("#review-category:visible");
}
