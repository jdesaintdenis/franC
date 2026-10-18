import { expect, test } from "./fixtures";

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
});

test("PWA shell: manifest is linked and navigation covers all sections", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

  // Default viewport is desktop: the sidebar shows the five entries.
  const nav = page.getByRole("navigation", { name: /^Main/ });
  for (const label of ["Home", "Transactions", "Plan", "Accounts", "More"]) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
  }
});

test("nav links navigate to their section", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: /^Main/ });

  await nav.getByRole("link", { name: "Transactions" }).click();
  await expect(page).toHaveURL("/transactions");
  await expect(page.getByRole("heading", { name: "Transactions", exact: true })).toBeVisible();
});

test.describe("month picker", () => {
  const HEADER =
    "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

  test("pick a month from another year, then go back to this month", async ({ page }) => {
    const stamp = Date.now();
    const file = `picker-${stamp}.csv`;
    // March 2009: a year no other spec uses, so February 2009 stays empty.
    const line = `15/03/2009;ZQPICK${stamp};PRLV ZQPICK${stamp};REF1;REF1-;Prelevement;;;-12,00;;15/03/2009;15/03/2009;0`;
    await page.goto("/import");
    await page.getByLabel("Choose your bank export").filter({ visible: true }).setInputFiles({
      name: file,
      mimeType: "text/csv",
      buffer: Buffer.from([HEADER, line].join("\n") + "\n", "utf-8"),
    });
    await page.getByRole("button", { name: "Import 1 transaction" }).click();
    await expect(page.getByText("1 imported")).toBeVisible();

    try {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto("/budget");
      await page.getByTestId("month-picker-trigger").click();
      const picker = page.getByRole("dialog", { name: "Choose a month" });
      await expect(picker).toBeVisible();
      await expect(picker.getByTestId("month-picker-cell")).toHaveCount(12);

      // Walk back to 2009 with the year arrows.
      const year = new Date().getFullYear();
      for (let y = year - 1; y >= 2009; y--) {
        await picker.getByRole("button", { name: `Go to ${y}` }).click();
      }
      await expect(picker.getByText("2009", { exact: true })).toBeVisible();
      await expect(picker.getByRole("button", { name: "February 2009" })).toHaveAttribute("aria-disabled", "true");

      await picker.getByRole("link", { name: /^March 2009, €12 spent$/ }).click();
      await expect(page).toHaveURL(/[?&]month=2009-03/);
      await expect(picker).toBeHidden();
      await expect(page.getByTestId("month-picker-trigger")).toHaveText(/March 2009/);

      await page.getByTestId("month-picker-trigger").click();
      await page.getByRole("dialog", { name: "Choose a month" }).getByRole("link", { name: "Back to this month" }).click();
      await expect(page).toHaveURL(/\/budget$/);
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
});
