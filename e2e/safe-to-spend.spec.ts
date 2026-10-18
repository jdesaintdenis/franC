import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { clearStartingBalances, manageSheet, setStartingBalance } from "./helpers/manage";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

const list = (page: Page) => page.getByRole("list", { name: "Your accounts" });
async function firstAccountName(page: Page): Promise<string> {
  await page.goto("/accounts");
  const label = await page.getByRole("button", { name: /^Options for / }).first().getAttribute("aria-label");
  return (label ?? "").replace(/^Options for /, "");
}

const card = (page: Page) => page.getByRole("region", { name: /^Until / });

// The worker's E2E user must end up without a starting balance and with the flag on.
test.afterEach(async ({ page }) => {
  await page.goto("/accounts");
  await expect(list(page)).toBeVisible();
  await setCounted(page, true);
  await clearStartingBalances(page);
});

/** Ticks or unticks "Count in safe to spend" in the first account's sheet. */
async function setCounted(page: Page, counted: boolean) {
  await page.goto("/accounts");
  await list(page).getByRole("listitem").first().getByRole("button").first().click();
  const box = manageSheet(page).getByLabel("Count in safe to spend");
  await box.setChecked(counted);
  // The box stays disabled until the change is saved.
  await expect(box).toBeEnabled();
  await expect(box).toBeChecked({ checked: counted });
  await page.keyboard.press("Escape");
  await expect(manageSheet(page)).toBeHidden();
}

test("safe to spend: card with breakdown, prompt when the account is not counted", async ({ page }) => {
  const stamp = Date.now();
  const file = `safe-${stamp}.csv`;
  // A transaction is needed for the card to show; a past year keeps it out of this month's budgets.
  const line = `10/01/2015;ZQSAFE${stamp};PRLV ZQSAFE${stamp};REF1;REF1-;Prelevement;;;-5,00;;10/01/2015;10/01/2015;0`;
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: file,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, line].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await expect(page.getByText("1 imported")).toBeVisible();

  try {
    await setStartingBalance(page, await firstAccountName(page), "1 234,56");

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    await expect(card(page)).toBeVisible();
    await expect(card(page).getByTestId("safe-to-spend-amount")).toContainText("€");
    // The 50 F hero: the amount in old francs, and the pace chart.
    await expect(card(page).getByTestId("francs-amount")).toHaveText(/^-?[\d,]+ francs$/);
    await expect(card(page).getByTestId("pace-chart")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // "How is this worked out?" opens the breakdown in a bottom sheet, to the cent.
    await card(page).getByRole("button", { name: "How is this worked out?" }).click();
    const sheet = page.getByRole("dialog", { name: "How it's worked out" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Balance", { exact: true })).toBeVisible();
    await expect(sheet.getByText(/1,234\.56/).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await setCounted(page, false);
    await page.goto("/");
    await expect(card(page)).toBeHidden();
    await expect(page.getByText(/Set a starting balance on an account counted in safe to spend/)).toBeVisible();
  } finally {
    await page.goto("/import");
    const hist = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: file });
    await hist.getByRole("button", { name: /^Options for / }).click();
    await page.getByRole("menuitem", { name: "Undo import" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(hist).toHaveCount(0);
  }
});
