import { expect, type Locator, type Page } from "@playwright/test";

/** Picks the franC account (or "Don't import") a bank account feeds, through the sheet. */
export async function chooseLink(card: Locator, account: RegExp | string, option: string) {
  await card.getByRole("button", { name: account }).click();
  await card.page().getByRole("dialog", { name: "franC account" }).getByRole("radio", { name: option }).click();
}

/** Opens the ⋯ menu of a connected bank card. */
export async function openConnectionMenu(card: Locator, bank: string) {
  await card.getByRole("button", { name: `Options for ${bank}` }).click();
}

/** Disconnects every bank connection on /accounts/bank (the link step's button or a connected card's menu). */
export async function disconnectAllBanks(page: Page) {
  const step = page.getByRole("button", { name: "Disconnect", exact: true });
  const menu = page.getByRole("button", { name: /^Options for / });
  for (;;) {
    if ((await step.count()) > 0) await step.first().click();
    else if ((await menu.count()) > 0) {
      await menu.first().click();
      await page.getByRole("menuitem", { name: "Disconnect bank" }).click();
    } else break;
    await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
  }
}

/**
 * "Save and sync" starts the first sync right after saving the links. Specs that need the state before
 * it (balance hint, CSV imported first, "Not synced yet", a counted Sync now) abort that second request.
 */
export async function holdFirstSync(page: Page) {
  let posts = 0;
  await page.route(/\/accounts\/bank/, (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"] && ++posts === 2) return route.abort();
    return route.continue();
  });
}
