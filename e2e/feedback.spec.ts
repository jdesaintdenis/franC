import { devices, type Locator, type Page, type Route } from "@playwright/test";

import { expect, test } from "./fixtures";
import { addCategory } from "./helpers/manage";
import { categorizeWaiting, clearQueue } from "./helpers/queue";
import { settled } from "./helpers/recurring";
import { toastWith } from "./helpers/sheet";
import { chooseCsv } from "./helpers/imports";

// Phone viewport, like transactions.spec.ts.
test.use({ ...devices["Pixel 7"] });

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

async function importRows(page: Page, label: string, count: number) {
  const rows = Array.from({ length: count }, (_, i) => {
    const date = `${String(10 + i).padStart(2, "0")}/05/2025`;
    return `${date};${label}${i};PRLV ${label}${i};RV${i};RV${i}-;Prelevement;;;-${10 + i},00;;${date};${date};0`;
  });
  await page.goto("/import");
  await chooseCsv(page, {
    name: `feedback-${label}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8"),
  });
  await page.getByRole("button", { name: `Import ${count} transactions` }).click();
  await expect(page.getByText(`${count} imported`)).toBeVisible();
}

/**
 * Holds every server action (POST with a `next-action` header) until `release()` is called;
 * `release()` resolves once the held calls have been answered.
 */
async function holdServerActions(page: Page) {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const inflight: Promise<unknown>[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      const done = (async () => {
        await gate;
        await route.fulfill({ response: await route.fetch() });
      })();
      inflight.push(done);
      await done;
    } else {
      await route.continue();
    }
  });
  return async () => {
    open();
    await Promise.all(inflight);
  };
}

/** Makes every server action fail; call the returned function to let them through again. */
async function failServerActions(page: Page) {
  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) await route.fulfill({ status: 500, body: "boom" });
    else await route.continue();
  };
  await page.route("**/*", handler);
  return () => page.unroute("**/*", handler);
}

test.describe("instant category changes", () => {
  async function setup(page: Page, ts: number) {
    const label = `FEEDBACK${ts}`;
    const category = `E2E Feedback ${ts}`;
    await addCategory(page, category);
    await importRows(page, label, 2);
    await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
    const list = page.getByRole("list", { name: "Transactions" });
    const rows = list.getByRole("button", { name: /^Categorize: / });
    await expect(rows).toHaveCount(2);
    return { category, list, rows };
  }

  async function changeFirstRow(page: Page, category: string, list: Locator) {
    // Keyboard equivalent of the swipe: the row's ⋯ button, then Change category.
    await list.getByTestId("row-more").first().focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Actions" }).getByRole("button", { name: "Change category" }).click();
    const picker = page.getByRole("dialog", { name: "Change category" });
    await picker.getByLabel("Search categories").fill(category);
    await picker.getByRole("button", { name: new RegExp(category) }).click();
    return picker;
  }

  test("the row, the picker and the toast change before the server answers", async ({ page }) => {
    const ts = Date.now();
    const { category, list, rows } = await setup(page, ts);

    const release = await holdServerActions(page);
    const picker = await changeFirstRow(page, category, list);

    // The server has not answered (it is held), yet the picker closed, the row changed and the toast shows.
    await expect(picker).toBeHidden();
    await expect(rows.first()).toContainText(category);
    await expect(toastWith(page, `Moved to ${category}`)).toBeVisible();

    await release();
    // Still there once the server has answered, and after a reload.
    await expect(rows.first()).toContainText(category);
    await page.reload();
    await expect(rows.first()).toContainText(category);
  });

  test("a refused save puts the row back and Try again works", async ({ page }) => {
    const ts = Date.now();
    const { category, list, rows } = await setup(page, ts);

    const stopFailing = await failServerActions(page);
    await changeFirstRow(page, category, list);

    // Back to what it was, with an error toast that offers Try again.
    const failure = toastWith(page, `Couldn't move it to ${category}`);
    await expect(failure).toBeVisible();
    await expect(rows.first()).not.toContainText(category);

    await stopFailing();
    // The retry is optimistic too: wait for its save before reloading.
    await settled(page, () => failure.getByRole("button", { name: "Try again" }).click());
    await expect(rows.first()).toContainText(category);
    await expect(toastWith(page, `Moved to ${category}`)).toBeVisible();

    await page.reload();
    await expect(rows.first()).toContainText(category);
  });
});

test.describe("review confirmations", () => {
  test("Mark reviewed leaves at once, and Undo from the toast brings it back", async ({ page, sql, workerUser }) => {
    const ts = Date.now();
    await clearQueue(page, sql, workerUser);
    await importRows(page, `FBREVIEW${ts}X`, 2);
    await categorizeWaiting(sql, workerUser);

    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "2 to review" })).toBeVisible();

    const release = await holdServerActions(page);
    await page.getByTestId("review-card").getByRole("button", { name: "Reviewed", exact: true }).click();
    // Held on the server, but the queue and the toast already moved on.
    await expect(page.getByRole("heading", { name: "1 to review" })).toBeVisible();
    const marked = toastWith(page, "Marked 1 as reviewed");
    await expect(marked).toBeVisible();

    // Undo is queued behind the save: tapped while it is in flight, it still lands after it.
    await marked.getByRole("button", { name: /^Undo/ }).click();
    await release();
    await expect(page.getByRole("heading", { name: "2 to review" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "2 to review" })).toBeVisible();
  });

  test("a refused Mark reviewed brings the row back with Try again", async ({ page, sql, workerUser }) => {
    const ts = Date.now();
    await clearQueue(page, sql, workerUser);
    await importRows(page, `FBREVFAIL${ts}X`, 2);
    await categorizeWaiting(sql, workerUser);

    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "2 to review" })).toBeVisible();

    const stopFailing = await failServerActions(page);
    await page.getByTestId("review-card").getByRole("button", { name: "Reviewed", exact: true }).click();
    const failure = toastWith(page, "Could not update the queue");
    await expect(failure).toBeVisible();
    await expect(page.getByRole("heading", { name: "2 to review" })).toBeVisible();

    await stopFailing();
    await failure.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "1 to review" })).toBeVisible();
  });
});
