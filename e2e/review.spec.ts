import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory, deleteCategoriesWithPrefix } from "./helpers/manage";
import { clearQueue } from "./helpers/queue";
import { pickCategory, reviewCategory, toastWith } from "./helpers/sheet";

const PREFIX = "E2E Review";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

async function importRows(page: Page, fileName: string, count: number, label: string) {
  const rows = Array.from({ length: count }, (_, i) => {
    const date = `${String(10 + i).padStart(2, "0")}/05/2025`;
    return `${date};${label}${i};PRLV ${label}${i};RV${i};RV${i}-;Prelevement;;;-${10 + i},00;;${date};${date};0`;
  });
  await page.goto("/import");
  await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: `Import ${count} transactions` }).click();
  await expect(page.getByText(`${count} imported`)).toBeVisible();
}

async function undoImport(page: Page, fileName: string) {
  await page.goto("/import");
  // Wait for the page before looking: a row missed here would be left behind for the next spec.
  await expect(page.getByRole("heading", { name: "Import", level: 1 })).toBeVisible();
  const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: fileName });
  if ((await row.count()) === 0) return;
  await row.getByRole("button", { name: /^Options for / }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row).toHaveCount(0);
}

async function deleteCategories(page: Page) {
  await deleteCategoriesWithPrefix(page, PREFIX);
}

/** Touch-style drag on the card through pointer events (Playwright has no swipe API). */
async function swipe(page: Page, dx: number) {
  await page.getByTestId("review-card").getByRole("heading", { level: 2 }).evaluate(async (el, distance) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + 20;
    const y = rect.top + rect.height / 2;
    const fire = (type: string, clientX: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX, clientY: y }),
      );
    fire("pointerdown", x);
    for (const step of [0.25, 0.5, 0.75, 1]) fire("pointermove", x + distance * step);
    fire("pointerup", x + distance);
  }, dx);
}

const files: string[] = [];

test.afterEach(async ({ page }) => {
  for (const file of files.splice(0)) await undoImport(page, file);
  await deleteCategories(page);
});

test.describe("desktop", () => {
  test("review: import, badge and dashboard count, categorize, keyboard, bare rows stay", async ({ page, sql, workerUser }) => {
    const ts = Date.now();
    const category = `${PREFIX} ${ts}`;
    const file = `review-${ts}.csv`;
    files.push(file);
    await clearQueue(page, sql, workerUser);

    await addCategory(page, category);

    await importRows(page, file, 4, `RVWSHOP${ts}X`);
    await expect(page.getByRole("link", { name: "Review the 4 new transactions" })).toBeVisible();

    // The count shows in the nav badge and on the dashboard.
    const nav = page.getByRole("navigation", { name: /^Main/ });
    await expect(nav.getByRole("link", { name: "Transactions, 4 to review" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByTestId("attention-review")).toContainText("4 transactions to review");
    await page.goto("/transactions");
    await expect(page.getByTestId("review-attention")).toContainText("4");

    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "4 to review" })).toBeVisible();
    await expect(page.getByTestId("review-progress")).toHaveText("1 of 4");

    // Picking a category saves it, marks the row reviewed and moves on.
    await pickCategory(page, reviewCategory(page), category);
    await expect(page.getByRole("heading", { name: "3 to review" })).toBeVisible();
    await expect(toastWith(page, `Moved to ${category}`)).toBeVisible();

    // Keyboard: ? opens the help.
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // A row without a category cannot be validated: R and Mark all leave it in the queue and say so.
    await page.keyboard.press("r");
    await expect(toastWith(page, "1 transaction without a category stays in the queue")).toBeVisible();
    await expect(page.getByRole("heading", { name: "3 to review" })).toBeVisible();
    await page.getByRole("button", { name: "Mark all as reviewed" }).click();
    await expect(toastWith(page, "3 transactions without a category stay in the queue")).toBeVisible();
    await expect(page.getByRole("heading", { name: "3 to review" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Transactions, 3 to review" })).toBeVisible();
  });

  test("review: shortcuts are ignored while typing in a field", async ({ page, sql, workerUser }) => {
    const ts = Date.now();
    const file = `review-keys-${ts}.csv`;
    files.push(file);
    await clearQueue(page, sql, workerUser);
    await importRows(page, file, 2, `RVWKEYS${ts}X`);

    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "2 to review" })).toBeVisible();
    // :visible, because a dev-mode Suspense stream can leave a hidden copy of the card (#S:0) behind.
    await expect(page.locator('[data-testid="review-progress"]:visible')).toHaveText("1 of 2");
    // A checkbox is a field: J must not move the card, but works again once the focus is elsewhere.
    await page.getByRole("checkbox").first().focus();
    await page.keyboard.press("j");
    await expect(page.locator('[data-testid="review-progress"]:visible')).toHaveText("1 of 2");
    await page.getByRole("checkbox").first().blur();
    await page.keyboard.press("j");
    await expect(page.locator('[data-testid="review-progress"]:visible')).toHaveText("2 of 2");
  });
});

test.describe("phone", () => {
  // Pixel 7 dimensions by hand: spreading the device descriptor sets a browser type, which a describe group cannot.
  test.use({ viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true });

  test("review: one card at a time, swipe left skips and swipe right asks for a category", async ({ page, sql, workerUser }) => {
    const ts = Date.now();
    const file = `review-phone-${ts}.csv`;
    files.push(file);
    await clearQueue(page, sql, workerUser);
    await importRows(page, file, 3, `RVWPHONE${ts}X`);

    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "3 to review" })).toBeVisible();
    await expect(page.getByTestId("review-card")).toHaveCount(1);
    await expect(page.getByRole("group", { name: "Rest of the queue" })).toBeHidden();
    await expect(page.getByTestId("review-progress")).toHaveText("1 of 3");

    // Tap targets are at least 44px tall. A bare row's big button picks a category instead of validating.
    const choose = page.getByTestId("review-card").getByRole("button", { name: "Choose a category", exact: true });
    expect((await choose.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await swipe(page, -200);
    await expect(page.getByTestId("review-progress")).toHaveText("2 of 3");
    await expect(page.getByRole("heading", { name: "3 to review" })).toBeVisible();

    // A short drag snaps back and changes nothing.
    await swipe(page, 40);
    await expect(page.getByTestId("review-progress")).toHaveText("2 of 3");

    // Swipe right on a row without a category opens the picker; it does not validate.
    await swipe(page, 200);
    await expect(page.getByRole("dialog", { name: "Change category" })).toBeVisible();
  });
});
