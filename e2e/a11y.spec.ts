import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { deleteConnections, seedConnection } from "./helpers/bank-seed";
import { addCategory, deleteCategory, manageSheet } from "./helpers/manage";
import { clearQueue } from "./helpers/queue";
import { pickCategory, reviewCategory, sheetOf } from "./helpers/sheet";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";
const ROWS = [
  "02/01/2025;A11Y SHOP;PRLV A11Y SHOP;A11Y1;A11Y1-;Prelevement;A11Y Courses;;-12,34;;02/01/2025;02/01/2025;0",
  "03/01/2025;A11Y SALARY;VIR A11Y SALARY;A11Y2;A11Y2-;Virement;;;;+1500,00;03/01/2025;03/01/2025;0",
];

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  // Readable failure output: rule id plus the offending selectors.
  const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `axe violations on ${page.url()}`).toEqual([]);
}

test("a11y: skip link is the first tab stop and moves focus to the content", async ({ page }) => {
  await page.goto("/settings");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

const PAGES = ["/", "/budget", "/year", "/recurring", "/import", "/transactions", "/settings", "/settings/categories", "/settings/budgets", "/settings/goals", "/settings/rules", "/settings/bank-categories", "/accounts", "/accounts/bank", "/settings/merchants", "/settings/export"];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const path of PAGES) {
      test(`a11y (${colorScheme}): ${path} has no serious violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await expectNoSeriousViolations(page);
      });
    }
  });
}

test.describe("desktop width, sidebar", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const path of ["/", "/budget", "/settings"]) {
    test(`a11y (desktop): ${path} has no serious violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expectNoSeriousViolations(page);
    });
  }
});

test.describe("dark theme, logged out", () => {
  test.use({ colorScheme: "dark" });

  test("a11y (dark): login page has no serious violations", async ({ browser, baseURL }) => {
    const anonymous = await browser.newContext({ colorScheme: "dark", storageState: { cookies: [], origins: [] } });
    try {
      const page = await anonymous.newPage();
      await page.goto(`${baseURL}/login`);
      await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
      await expectNoSeriousViolations(page);
    } finally {
      await anonymous.close();
    }
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme, dialog`, () => {
    test.use({ colorScheme });

    test(`a11y (${colorScheme}): transactions list and detail sheet (main view, category step) have no serious violations`, async ({ page }) => {
      await page.goto("/import");
      await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
        name: "a11y.csv",
        mimeType: "text/csv",
        buffer: Buffer.from([HEADER, ...ROWS].join("\n"), "utf-8"),
      });
            // A rerun may find only duplicates: then there is nothing to import.
      const go = page.getByRole("button", { name: /^(Import \d+|Choose another file)/ });
      await expect(go).toBeVisible();
      if (/^Import/.test((await go.textContent()) ?? "")) {
        await go.click();
        await expect(page.getByRole("status").filter({ hasText: "imported" })).toBeVisible();
      }

      await page.goto("/transactions?q=A11Y");
      const row = page.getByRole("button", { name: /Categorize/ }).first();
      await expect(row).toBeVisible();
      await expectNoSeriousViolations(page);

      await row.click();
      const sheet = sheetOf(page);
      await expect(sheet).toBeVisible();
      // Mid fade-in the blended colors give false color-contrast failures; wait for the animation to end.
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await expectNoSeriousViolations(page);

      // The category step replaces the main view in the same sheet.
      await sheet.getByTestId("sheet-category").click();
      await expect(sheet.getByRole("heading", { name: "Choose a category" })).toBeVisible();
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await expectNoSeriousViolations(page);
    });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme, icon picker`, () => {
    test.use({ colorScheme });

    test(`a11y (${colorScheme}): emoji picker dialog has no serious violations`, async ({ page }) => {
      await page.goto("/settings/categories?add=1");
      await manageSheet(page).getByRole("button", { name: "Choose an icon" }).click();
      const dialog = page.getByRole("dialog", { name: "Choose an icon" });
      await expect(dialog).toBeVisible();
      // Wait for the lazy chunk and the self-hosted data: the grid replaces the loading text.
      await expect(dialog.getByRole("gridcell").first()).toBeVisible();
      await page.waitForFunction(() => document.getAnimations().length === 0);
      await expectNoSeriousViolations(page);
    });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme, review`, () => {
    test.use({ colorScheme });

    test(`a11y (${colorScheme}): review queue and empty state have no serious violations`, async ({ page, sql, workerUser }) => {
      const file = `a11y-review-${colorScheme}-${Date.now()}.csv`;
      const label = `A11YRVW${Date.now()}`;
      await page.goto("/import");
      await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
        name: file,
        mimeType: "text/csv",
        buffer: Buffer.from(
          [HEADER, `05/01/2025;${label};PRLV ${label};RV1;RV1-;Prelevement;;;-9,99;;05/01/2025;05/01/2025;0`].join("\n"),
          "utf-8",
        ),
      });
      await page.getByRole("button", { name: /^Import/ }).click();
      await expect(page.getByRole("status").filter({ hasText: "imported" })).toBeVisible();

      try {
        await page.goto("/review");
        await expect(page.locator('[data-testid="review-card"]:visible')).toBeVisible();
        await page.waitForFunction(() => document.getAnimations().length === 0);
        await expectNoSeriousViolations(page);

        // Mark all leaves rows without a category (SPEC §73 A): empty the queue in the database.
        await clearQueue(page, sql, workerUser);
        await expectNoSeriousViolations(page);
      } finally {
        await page.goto("/import");
        const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: file });
        if ((await row.count()) > 0) {
          await row.getByRole("button", { name: /^Options for / }).click();
          await page.getByRole("menuitem", { name: "Undo import" }).click();
          await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
          await expect(page.getByRole("alertdialog")).toBeHidden();
          await expect(row).toHaveCount(0);
        }
      }
    });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme, category guessing`, () => {
    test.use({ colorScheme });

    test(`a11y (${colorScheme}): review card with a guess and the rule suggestions have no serious violations`, async ({ page }) => {
      const ts = Date.now();
      const category = `E2E Guess A11y ${colorScheme} ${ts}`;
      const label = `A11YGUESS${ts}X`;
      const files = [`a11y-guess-a-${colorScheme}-${ts}.csv`, `a11y-guess-b-${colorScheme}-${ts}.csv`];
      const importRows = async (file: string, days: number[]) => {
        const rows = days.map(
          (d) => `${String(d).padStart(2, "0")}/01/2025;${label};PRLV ${label};AG${d};AG${d}-;Prelevement;;;-${d},50;;${String(d).padStart(2, "0")}/01/2025;${String(d).padStart(2, "0")}/01/2025;0`,
        );
        await page.goto("/import");
        await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({ name: file, mimeType: "text/csv", buffer: Buffer.from([HEADER, ...rows].join("\n") + "\n", "utf-8") });
        await page.getByRole("button", { name: /^Import/ }).click();
        await expect(page.getByRole("status").filter({ hasText: "imported" })).toBeVisible();
      };

      await addCategory(page, category);
      try {
        // Three hand categorizations (a rule suggestion), then a fourth row that arrives as a guess.
        await importRows(files[0], [10, 11, 12]);
        await page.goto("/review");
        // Other specs may leave rows in the queue, so wait for the card to change rather than count.
        for (let i = 0; i < 2; i++) {
          const before = await page.locator('[data-testid="review-card"]:visible').getAttribute("data-transaction-id");
          await pickCategory(page, reviewCategory(page), category);
          await expect(page.locator('[data-testid="review-card"]:visible')).not.toHaveAttribute("data-transaction-id", before ?? "");
        }
        await pickCategory(page, reviewCategory(page), category);
        await expect(page.getByTestId("rule-suggestion")).toBeVisible();
        await importRows(files[1], [20]);

        await page.goto("/review");
        await expect(page.locator('[data-testid="review-card"]:visible').locator('[data-slot="category-source"]')).toContainText("Guess");
        await page.waitForFunction(() => document.getAnimations().length === 0);
        await expectNoSeriousViolations(page);

        await page.goto("/settings/rules");
        await expect(page.getByRole("region", { name: "Suggested rules" })).toBeVisible();
        await page.waitForFunction(() => document.getAnimations().length === 0);
        await expectNoSeriousViolations(page);
      } finally {
        for (const file of files) {
          await page.goto("/import");
          const row = page.getByRole("list", { name: "Import history" }).getByRole("listitem").filter({ hasText: file });
          if ((await row.count()) > 0) {
            await row.getByRole("button", { name: /^Options for / }).click();
            await page.getByRole("menuitem", { name: "Undo import" }).click();
            await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
            await expect(page.getByRole("alertdialog")).toBeHidden();
            await expect(row).toHaveCount(0);
          }
        }
        await deleteCategory(page, category);
      }
    });
  });
}

test("a11y: split editor has no serious violations", async ({ page }) => {
  // The editor needs at least one category to open; the E2E user may have none on a fresh database.
  const name = `E2E Split A11y ${Date.now()}`;
  await addCategory(page, name);

  try {
    await page.goto("/import");
    await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
      name: "a11y.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([HEADER, ...ROWS].join("\n"), "utf-8"),
    });
    const go = page.getByRole("button", { name: /^(Import \d+|Choose another file)/ });
    await expect(go).toBeVisible();
    if (/^Import/.test((await go.textContent()) ?? "")) {
      await go.click();
      await expect(page.getByRole("status").filter({ hasText: "imported" })).toBeVisible();
    }

    await page.goto("/transactions?q=A11Y+SHOP");
    await page.getByRole("button", { name: /Categorize/ }).first().click();
    await expect(sheetOf(page)).toBeVisible();
    await sheetOf(page).getByTestId("sheet-split").click();
    await page.getByRole("button", { name: "Add part" }).click();
    await expect(page.getByLabel("Amount (part 2)")).toBeVisible();
    await page.waitForFunction(() => document.getAnimations().length === 0);
    await expectNoSeriousViolations(page);
  } finally {
    await deleteCategory(page, name);
  }
});

// Slice 49: a connected account brings the sync line, the reconnect row and card, and the Accounts tab's bank sync and imports.
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme, bank connected and due to reconnect`, () => {
    test.use({ colorScheme });

    // Seeded per test, not per describe: the @bank tag runs these one at a time across workers, so
    // another worker's daily-cron call never syncs into this worker's Main account.
    test.beforeEach(async ({ sql, workerUser }) => {
      const [main] = await sql`select id from accounts where user_id = ${workerUser.id} order by created_at limit 1`;
      await seedConnection(sql, workerUser.id, [main.id], { validForDays: 10 });
    });
    test.afterEach(async ({ sql, workerUser }) => {
      await deleteConnections(sql, workerUser.id);
    });

    for (const path of ["/", "/accounts", "/settings", "/accounts/bank"]) {
      test(`a11y (${colorScheme}, connected): ${path} has no serious violations`, { tag: "@bank" }, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        if (path === "/") await expect(page.getByTestId("sync-line")).toBeVisible();
        if (path === "/accounts") await expect(page.getByRole("link", { name: /^Import a CSV/ })).toBeVisible();
        if (path === "/accounts/bank") await expect(page.getByRole("link", { name: "Reconnect" })).toBeVisible();
        await expectNoSeriousViolations(page);
      });
    }
  });
}
