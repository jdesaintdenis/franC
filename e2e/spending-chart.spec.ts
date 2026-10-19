import { devices, type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { deleteCategory, manageSheet, pickCategoryIcon, rowMenuAction } from "./helpers/manage";
import { chooseCsv } from "./helpers/imports";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

interface Fixture {
  month: string;
  parent: string;
  big: string;
  small: string;
  fileName: string;
}

/**
 * Imports a month where one bank category (created by the preselected "Create") has two
 * subcategories at 75% / 25%, and gives that category a 🏠 icon.
 */
async function seedMonth(page: Page): Promise<Fixture> {
  const ts = Date.now();
  // A random month in 1991-2000 keeps the chart free of other specs' data.
  const year = 1991 + Math.floor(Math.random() * 10);
  const mm = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const parent = `E2E Chart ${ts}`;
  const big = `Big ${ts}`;
  const small = `Small ${ts}`;
  const row = (i: number, sub: string, debit: string) => {
    const date = `${String(10 + i).padStart(2, "0")}/${mm}/${year}`;
    const label = `CHART${ts} R${i}`;
    return `${date};${label};CB ${label};REF${i};;Carte bancaire;${parent};${sub};${debit};;${date};${date};0`;
  };
  const fileName = `chart-${ts}.csv`;

  await page.goto("/import");
  await chooseCsv(page, {
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, row(0, big, "-75,00"), row(1, small, "-25,00")].join("\n") + "\n", "utf-8"),
  });
  // New bank categories are preselected to "Create": nothing to click before importing.
  await expect(page.getByRole("region", { name: /bank categor/ })).toContainText("will be created in your categories");
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByText("2 imported")).toBeVisible();

  await page.goto("/settings/categories");
  await rowMenuAction(page, parent, "Rename, icon, colour");
  const editSheet = manageSheet(page);
  await pickCategoryIcon(page, editSheet, { search: "house", emoji: "🏠" });
  await expect(editSheet.getByRole("button", { name: "Change icon, currently 🏠" })).toBeVisible();
  await editSheet.getByRole("button", { name: "Save" }).click();
  await expect(editSheet).toBeHidden();
  await expect(page.getByTestId("category-row").filter({ hasText: parent }).first().getByTestId("category-icon")).toHaveText("🏠");

  return { month: `${year}-${mm}`, parent, big, small, fileName };
}

async function cleanUp(page: Page, f: Fixture) {
  await page.goto("/import");
  const historyRow = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: f.fileName });
  await historyRow.getByRole("button", { name: /^Options for / }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(historyRow).toHaveCount(0);
  for (const name of [f.big, f.small, f.parent]) await deleteCategory(page, name);
}

/** The middle of the slice, marked by an invisible anchor, so the tap lands inside it whatever its size. */
async function slicePoint(page: Page, name: string) {
  const anchor = page.getByTestId("category-chart").locator(`[data-slice-name="${name}"] [data-slice-anchor]`);
  // The ring sits below the month card and the budgets on a phone.
  await anchor.scrollIntoViewIfNeeded();
  const box = await anchor.boundingBox();
  if (!box) throw new Error("slice anchor not rendered");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("on a phone", () => {
  // Pixel 7 without its defaultBrowserType, which can't be set inside a describe.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("tapping a slice shows its details without leaving the page, and Open goes to the category", async ({ page }) => {
    const f = await seedMonth(page);
    try {
      await page.goto(`/budget?month=${f.month}`);
      const url = page.url();
      const card = page.getByTestId("category-detail");
      await expect(card).toHaveCount(0);

      const point = await slicePoint(page, f.parent);
      await page.touchscreen.tap(point.x, point.y);
      await expect(card).toBeVisible();
      expect(page.url()).toBe(url);
      // A finger starting a scroll is a pointerdown outside the chart with no click after it: the card stays.
      await page.evaluate(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })));
      await expect(card).toBeVisible();
      await expect(card.getByText(f.parent)).toBeVisible();
      const subs = card.getByRole("list", { name: "Subcategories" });
      await expect(subs.getByRole("listitem").filter({ hasText: f.big })).toContainText("75%");
      await expect(subs.getByRole("listitem").filter({ hasText: f.small })).toContainText("25%");
      // These subcategories have no emoji, so they show their colour dot.
      await expect(subs.getByTestId("category-icon")).toHaveCount(0);
      // The list highlights the same category.
      await expect(page.getByRole("link", { name: new RegExp(`^${f.parent}`) })).toHaveAttribute("aria-current", "true");

      // Tapping elsewhere clears the selection.
      await page.getByRole("heading", { name: "Where it went" }).tap();
      await expect(card).toHaveCount(0);

      const again = await slicePoint(page, f.parent);
      await page.touchscreen.tap(again.x, again.y);
      await card.getByRole("link", { name: "Open" }).tap();
      await expect(page).toHaveURL(/[?&]category=/);
    } finally {
      await cleanUp(page, f);
    }
  });

  test("opening a category's subcategories keeps the scroll position, and Back returns", async ({ page }) => {
    const f = await seedMonth(page);
    try {
      await page.goto(`/budget?month=${f.month}`);
      const row = page.getByRole("link", { name: new RegExp(`^${f.parent}`) });
      await row.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 200));
      const before = await page.evaluate(() => window.scrollY);
      expect(before).toBeGreaterThan(0);
      await row.click();
      await expect(page).toHaveURL(/[?&]category=/);
      await expect(page.getByRole("heading", { name: new RegExp(`^${f.parent}`) })).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(page.getByRole("link", { name: "Back to all categories" })).toBeInViewport();
      await page.goBack();
      await expect(page).not.toHaveURL(/[?&]category=/);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
    } finally {
      await cleanUp(page, f);
    }
  });
});

test.describe("with a mouse", () => {
  // The project already runs as Desktop Chrome.

  test("hovering a slice shows its details and clicking opens the category", async ({ page }) => {
    const f = await seedMonth(page);
    try {
      await page.goto(`/budget?month=${f.month}`);
      const card = page.getByTestId("category-detail");

      const point = await slicePoint(page, f.parent);
      await page.mouse.move(point.x, point.y);
      await expect(card).toBeVisible();
      await expect(card.getByText(f.big)).toBeVisible();

      // Keyboard focus on the list row shows the same card and highlights the row.
      await page.mouse.move(0, 0);
      await expect(card).toHaveCount(0);
      const row = page.getByRole("link", { name: new RegExp(`^${f.parent}`) });
      await page.keyboard.press("Shift");
      await row.focus();
      await expect(card).toBeVisible();
      await expect(row).toHaveAttribute("aria-current", "true");
      await row.blur();
      await expect(card).toHaveCount(0);

      // Focusing the row can scroll the page, so measure the slice again before clicking.
      const clickAt = await slicePoint(page, f.parent);
      await page.mouse.click(clickAt.x, clickAt.y);
      await expect(page).toHaveURL(/[?&]category=/);
    } finally {
      await cleanUp(page, f);
    }
  });
});
