import { expect, type Locator, type Page } from "@playwright/test";

/** Opens the "⋯" menu named "Options for <name>" and returns the open menu. */
export async function openRowMenu(page: Page, name: string): Promise<Locator> {
  const menu = page.getByRole("menu", { name: `Options for ${name}`, exact: true });
  await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens a row's "⋯" menu and picks `item`. */
export async function rowMenuAction(page: Page, name: string, item: string | RegExp): Promise<void> {
  const menu = await openRowMenu(page, name);
  await menu.getByRole("menuitem", { name: item }).click();
}

/** The management sheet (add or edit) currently open. */
export function manageSheet(page: Page): Locator {
  return page.getByRole("dialog");
}

/**
 * Sets the monthly budget of a category through the Budgets screen: edits the existing budget
 * or picks the category in "Add a budget". `amount` is what you type ("10,50"); `rollover`
 * left undefined keeps the switch as it is.
 */
export async function setBudget(
  page: Page,
  categoryName: string,
  amount: string,
  options: { rollover?: boolean } = {},
): Promise<void> {
  await page.goto("/settings/budgets");
  const existing = page.getByRole("button", { name: `Edit budget for ${categoryName}`, exact: true });
  const sheet = manageSheet(page);
  if ((await existing.count()) > 0) {
    await existing.click();
  } else {
    await page.getByRole("link", { name: "Add a budget" }).click();
    const escaped = categoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await sheet.getByRole("button", { name: new RegExp(`^${escaped}(\\s|$)`) }).click();
  }
  await sheet.getByLabel("Monthly budget").fill(amount);
  if (options.rollover !== undefined) {
    const toggle = sheet.getByRole("switch", { name: "Roll over" });
    if ((await toggle.getAttribute("aria-checked")) !== String(options.rollover)) await toggle.click();
  }
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
}

/** Adds an account through the header's "Add" sheet. */
export async function addAccount(page: Page, name: string): Promise<void> {
  await page.goto("/accounts?add=1");
  const sheet = manageSheet(page);
  await sheet.getByLabel("Account name").fill(name);
  await sheet.getByRole("button", { name: "Add account" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: `Options for ${name}`, exact: true })).toBeVisible();
}

/** Deletes an account from its "⋯" menu and confirms the dialog. The page must be on Settings > Accounts. */
export async function deleteAccount(page: Page, name: string | RegExp): Promise<void> {
  const trigger = typeof name === "string" ? `Options for ${name}` : name;
  const button = page.getByRole("button", { name: trigger, exact: typeof name === "string" });
  await button.first().click();
  await openMenu(page).getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
}

/** Deletes every account whose name starts with `prefix` (spec cleanup, even after a failure). */
export async function deleteAccountsWithPrefix(page: Page, prefix: string): Promise<void> {
  await page.goto("/accounts");
  // Counting while the page still shows its loading state would find nothing to delete.
  await expect(page.getByRole("list", { name: "Your accounts" })).toBeVisible();
  const options = new RegExp(`^Options for ${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  let remaining = await page.getByRole("button", { name: options }).count();
  while (remaining > 0) {
    await deleteAccount(page, options);
    // The deleted row leaves the list a moment after the dialog closes. Counting again before that
    // clicked a row that was about to detach, then waited for a button that would never come back.
    remaining -= 1;
    await expect(page.getByRole("button", { name: options })).toHaveCount(remaining);
  }
}

/** Opens the account sheet from "⋯ > Starting balance". */
export async function openStartingBalance(page: Page, accountName: string): Promise<Locator> {
  await rowMenuAction(page, accountName, "Starting balance");
  const sheet = manageSheet(page);
  await expect(sheet.getByLabel("Balance", { exact: true })).toBeVisible();
  return sheet;
}

/** Sets an account's starting balance (`amount` as typed, "1 234,56") and its optional alert level. */
export async function setStartingBalance(
  page: Page,
  accountName: string,
  amount: string,
  options: { threshold?: string } = {},
): Promise<void> {
  await page.goto("/accounts");
  const sheet = await openStartingBalance(page, accountName);
  await sheet.getByLabel("Balance", { exact: true }).fill(amount);
  if (options.threshold !== undefined) await sheet.getByLabel("Warn me below").fill(options.threshold);
  await sheet.getByRole("button", { name: "Save balance" }).click();
  await expect(sheet).toBeHidden();
}

/** Removes the starting balance of every account (spec cleanup). */
export async function clearStartingBalances(page: Page): Promise<void> {
  await page.goto("/accounts");
  await expect(page.getByRole("list", { name: "Your accounts" })).toBeVisible();
  const options = page.getByRole("button", { name: /^Options for / });
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    await options.nth(i).click();
    await openMenu(page).getByRole("menuitem", { name: "Starting balance" }).click();
    const sheet = manageSheet(page);
    const remove = sheet.getByRole("button", { name: "Remove starting balance" });
    await expect(sheet.getByLabel("Balance", { exact: true })).toBeVisible();
    if ((await remove.count()) > 0) await remove.click();
    else await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
}

/** Opens the emoji picker from the icon button inside `scope` (a sheet) and picks the first match for `search`. */
export async function pickCategoryIcon(
  page: Page,
  scope: Locator,
  { search, emoji, buttonName = /^Choose an icon$/ }: { search: string; emoji: string; buttonName?: RegExp },
): Promise<void> {
  await scope.getByRole("button", { name: buttonName }).click();
  // The picker is a second dialog on top of the sheet, so it is found by its own title.
  const picker = page.getByRole("dialog", { name: /^(Choose an icon|Choisir une icône)$/ });
  await picker.getByRole("searchbox").or(picker.getByRole("textbox")).first().fill(search);
  await picker.getByRole("gridcell").filter({ hasText: emoji }).first().click();
  await expect(picker).toBeHidden();
}

/**
 * Creates a category through the header's "Add" sheet (English UI). `parent` files it under that
 * top-level category; `icon` picks an emoji by search.
 */
export async function addCategory(
  page: Page,
  name: string,
  options: { parent?: string; icon?: { search: string; emoji: string } } = {},
): Promise<void> {
  await page.goto("/settings/categories?add=1");
  const sheet = manageSheet(page);
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  if (options.parent) await sheet.getByRole("radiogroup", { name: "Parent category" }).getByText(options.parent, { exact: true }).click();
  if (options.icon) await pickCategoryIcon(page, sheet, options.icon);
  await sheet.getByRole("button", { name: "Add category" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: `Options for ${name}`, exact: true }).first()).toBeVisible();
}

/** Adds a subcategory from the parent's "⋯ > Add a subcategory". The page must be on Settings > Categories. */
export async function addSubcategory(page: Page, parentName: string, name: string): Promise<void> {
  await rowMenuAction(page, parentName, "Add a subcategory");
  const sheet = manageSheet(page);
  await expect(sheet.getByRole("radio", { name: "None (top-level)" })).not.toBeChecked();
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByRole("button", { name: "Add category" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: `Options for ${name}`, exact: true })).toBeVisible();
}

/**
 * Deletes a category from its "⋯" menu and does nothing when it is already gone (spec cleanup).
 * An unused category goes at once (toast with Undo); one something depends on opens the choices
 * sheet, where `choice` picks a radio by its label and "Delete category" confirms.
 */
export async function deleteCategory(page: Page, name: string, options: { choice?: RegExp } = {}): Promise<void> {
  await page.goto("/settings/categories");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await deleteCategoryOnPage(page, name, options);
}

async function deleteCategoryOnPage(page: Page, name: string, options: { choice?: RegExp } = {}): Promise<void> {
  const trigger = page.getByRole("button", { name: `Options for ${name}`, exact: true });
  if ((await trigger.count()) === 0) return;
  await rowMenuAction(page, name, "Delete");
  const sheet = manageSheet(page);
  const confirm = sheet.getByRole("button", { name: "Delete category" });
  await expect(confirm.or(page.getByText(`${name} deleted`))).toBeVisible();
  if (await confirm.isVisible()) {
    if (options.choice) await sheet.getByLabel(options.choice).check();
    await confirm.click();
    await expect(sheet).toBeHidden();
  }
  await expect(trigger).toHaveCount(0);
}

/** Deletes every category whose name starts with `prefix` (spec cleanup, even after a failure). */
export async function deleteCategoriesWithPrefix(page: Page, prefix: string): Promise<void> {
  await page.goto("/settings/categories");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const options = new RegExp(`^Options for ${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  for (;;) {
    const label = await page.getByRole("button", { name: options }).first().getAttribute("aria-label", { timeout: 1000 }).catch(() => null);
    if (label === null) return;
    await deleteCategoryOnPage(page, label.replace(/^Options for /, ""));
  }
}

/**
 * Adds a rule through the header's "Add" sheet. The category is picked by its option label
 * ("Parent > Child" for a subcategory); `apply` leaves the "Apply to uncategorized" box as is.
 */
export async function addRule(
  page: Page,
  rule: { category: string; pattern: string; matchType?: "contains" | "equals" | "regex"; apply?: boolean },
): Promise<void> {
  await page.goto("/settings/rules?add=1");
  const sheet = manageSheet(page);
  await sheet.getByLabel("Category").selectOption({ label: rule.category });
  await sheet.getByLabel("Match type").selectOption(rule.matchType ?? "contains");
  await sheet.getByLabel("Pattern").fill(rule.pattern);
  if (rule.apply === false) await sheet.getByLabel("Apply to uncategorized transactions").uncheck();
  await sheet.getByRole("button", { name: "Add rule" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("list", { name: "Rules in evaluation order" }).locator("code", { hasText: rule.pattern })).toBeVisible();
}

/** Deletes the rule with this pattern from its "⋯" menu (immediate, with Undo). Does nothing when it is gone. */
export async function deleteRule(page: Page, pattern: string): Promise<void> {
  await page.goto("/settings/rules");
  const trigger = page.getByRole("button", { name: `Options for ${pattern}`, exact: true });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if ((await trigger.count()) === 0) return;
  await rowMenuAction(page, pattern, "Delete");
  await expect(page.getByText("Rule deleted")).toBeVisible();
  await expect(trigger).toHaveCount(0);
}

/** The "⋯" menu that is open now (one closed a moment ago can still be fading out). */
export function openMenu(page: Page): Locator {
  return page.locator('[role="menu"][data-state="open"]');
}
