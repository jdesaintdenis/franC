import { devices, type Locator } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory } from "./helpers/manage";
import { chooseCsv } from "./helpers/imports";

// Phone-sized viewport: the list is mobile-first and virtualized against the window.
test.use({ ...devices["Pixel 7"] });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";
const ROWS = 60;

// Row i: a distinct date (oldest is i = 0), even rows are expenses of (10 + i) EUR,
// odd rows are incomes of the same size.
function csvRow(label: string, i: number) {
  const date = `${String(1 + (i % 20)).padStart(2, "0")}/${String(1 + Math.floor(i / 20)).padStart(2, "0")}/2025`;
  const rowLabel = `${label} R${String(i).padStart(3, "0")}`;
  const amount = 10 + i;
  const debit = i % 2 === 0 ? `-${amount},00` : "";
  const credit = i % 2 === 1 ? `+${amount},00` : "";
  return `${date};${rowLabel};PRLV ${rowLabel};REF${i};REF${i}-;Prelevement;;;${debit};${credit};${date};${date};0`;
}

test("transactions: search, infinite scroll, amount + direction filter, clear", async ({ page }) => {
  const label = `E2E-${Date.now()}`;
  const lines = [HEADER, ...Array.from({ length: ROWS }, (_, i) => csvRow(label, i))];

  await page.goto("/import");
  await chooseCsv(page, {
    name: `tx-${Date.now()}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: `Import ${ROWS} transactions` }).click();
  // 50+ rows: the result leads with the one-button bulk review.
  await expect(page.getByText(`${ROWS} transactions imported`)).toBeVisible();

  // Live search: no Apply button, the URL follows the typing.
  await page.goto("/transactions");
  await page.getByLabel("Search").fill(label);
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByText(`${ROWS} transactions`, { exact: true })).toBeVisible();

  // Grouped by day: one header per date with the day's total (R059 = +69,00 € on 20/03/2025).
  const list = page.getByRole("list", { name: "Transactions" });
  await expect(list.getByText(`${label} R059`)).toBeVisible();
  const firstHeader = list.getByTestId("day-header").first();
  await expect(firstHeader.getByRole("heading", { level: 2 })).toHaveText(/20 Mar 2025/);
  await expect(firstHeader.getByTestId("day-total")).toHaveText(/\+€69\.00/);
  // Newest first; the oldest row only exists in the DOM after scrolling loads page 2. "End of list"
  // shows as soon as page 2 lands, while the window is still at the old bottom and the new last rows
  // are beyond the virtualizer's overscan, so keep scrolling until the oldest row is rendered too.
  await expect
    .poll(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      return (await page.getByText("End of list").isVisible()) && (await list.getByText(`${label} R000`).isVisible());
    })
    .toBe(true);
  // The last row must not be hidden under the fixed bottom nav, once scrolled to the very
  // bottom (the virtualizer can still grow the page after the first scroll).
  await expect
    .poll(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const lastBox = await list.getByText(`${label} R000`).boundingBox();
      const navBox = await page.getByRole("navigation", { name: /^Main/ }).boundingBox();
      return lastBox !== null && navBox !== null && lastBox.y + lastBox.height <= navBox.y;
    })
    .toBe(true);

  // Expenses between 30 and 40 EUR: even rows 20..30 -> 6 transactions.
  await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
  await page.getByTestId("filters-button").click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByLabel("Min €").fill("30");
  await sheet.getByLabel("Max €").fill("40");
  await sheet.getByText("Expenses", { exact: true }).click();
  await sheet.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("6 transactions", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/direction=out/);

  // The Expenses chip is active; tapping it removes the filter (rows 20..30, both directions -> 11).
  await page.getByRole("link", { name: "Remove filter: Expenses" }).click();
  await expect(page).not.toHaveURL(/direction=/);
  await expect(page.getByText("11 transactions", { exact: true })).toBeVisible();

  // Dates typed day-first, whatever the browser's language.
  await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
  await page.getByTestId("filters-button").click();
  await sheet.getByLabel("From").fill("01/02/2025");
  await sheet.getByLabel("To").fill("05/02/2025");
  await sheet.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/from=2025-02-01/);
  await expect(page).toHaveURL(/to=2025-02-05/);
  await expect(page.getByText("5 transactions", { exact: true })).toBeVisible();

  // Clearing the search shows everything again.
  await page.getByLabel("Search").fill("");
  await expect(page).not.toHaveURL(/q=/);
});

/** Touch-style horizontal drag on a row through pointer events (Playwright has no swipe API). */
async function swipe(row: Locator, dx: number) {
  await row.evaluate(async (el, distance) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - distance / 2;
    const y = rect.top + rect.height / 2;
    const fire = (type: string, clientX: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX, clientY: y }),
      );
    fire("pointerdown", x);
    for (const step of [0.25, 0.5, 0.75, 1]) fire("pointermove", x + distance * step);
    fire("pointerup", x + distance);
  }, dx);
}

test("transactions: swipe right to recategorize, and the keyboard equivalent", async ({ page }) => {
  const ts = Date.now();
  const label = `SWIPE${ts}`;
  const category = `E2E Swipe ${ts}`;
  await addCategory(page, category);

  await page.goto("/import");
  await chooseCsv(page, {
    name: `swipe-${ts}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, csvRow(label, 0), csvRow(label, 2)].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await expect(page.getByText("2 imported")).toBeVisible();

  await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
  const list = page.getByRole("list", { name: "Transactions" });
  const rows = list.getByRole("button", { name: /^Categorize: / });
  await expect(rows).toHaveCount(2);

  // Swipe the first row right: the category picker opens; pick the category.
  await swipe(rows.first(), 220);
  const picker = page.getByRole("dialog", { name: "Change category" });
  await expect(picker).toBeVisible();
  await picker.getByLabel("Search categories").fill(category);
  await picker.getByRole("button", { name: new RegExp(category) }).click();
  await expect(picker).toBeHidden();
  await expect(rows.first()).toContainText(category);
  await expect(page.getByText(`Moved to ${category}`)).toBeVisible();

  // Keyboard: the row's ⋯ button opens the actions, then Change category.
  const more = list.getByTestId("row-more").nth(1);
  await more.focus();
  await page.keyboard.press("Enter");
  const actions = page.getByRole("dialog", { name: "Actions" });
  await actions.getByRole("button", { name: "Change category" }).click();
  await expect(picker).toBeVisible();
  await picker.getByLabel("Search categories").fill(category);
  await picker.getByRole("button", { name: new RegExp(category) }).press("Enter");
  await expect(rows.nth(1)).toContainText(category);

  // Swipe left opens the actions sheet too.
  await swipe(rows.first(), -220);
  await expect(actions).toBeVisible();
  await page.keyboard.press("Escape");

  // The page menu holds Select.
  await page.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("dialog", { name: "Options" }).getByRole("button", { name: "Select" }).click();
  await expect(list.getByRole("checkbox")).toHaveCount(2);
});
