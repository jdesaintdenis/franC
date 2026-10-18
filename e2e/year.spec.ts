import AxeBuilder from "@axe-core/playwright";
import { type Page } from "@playwright/test";

import {
  formatCents,
  formatSignedWholeCents,
  formatWholeCents,
} from "../src/lib/money";

import { expect, test } from "./fixtures";

test.setTimeout(120_000);

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

function row(date: string, label: string, debit: string, credit: string) {
  return `${date};${label};PRLV ${label};REF1;REF1-;Prelevement;;;${debit};${credit};${date};${date};0`;
}

// formatCents uses non-breaking spaces in some locales: match the exact string.
function exact(text: string) {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

async function undoImport(page: Page, fileName: string) {
  await page.goto("/import");
  const historyRow = page
    .getByRole("list", { name: "Import history" })
    .getByRole("listitem")
    .filter({ hasText: fileName });
  await historyRow.getByRole("button", { name: /^Options for / }).click();
  await page.getByRole("menuitem", { name: "Undo import" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Undo import" })
    .click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(historyRow).toHaveCount(0);
}

test("year review: headline, best and toughest months, months, categories, period sheet and phone layout", async ({
  page,
}) => {
  const stamp = Date.now();
  const label = `E2E-YEAR-${stamp}`;
  // A random past year keeps the totals free of other specs' data.
  const year = 2011 + Math.floor(Math.random() * 10);
  const fileName = `year-${stamp}.csv`;
  await page.goto("/import");
  await page
    .getByLabel("Choose your bank export")
    .filter({ visible: true })
    .setInputFiles({
      name: fileName,
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          HEADER,
          row(`10/01/${year}`, `${label}-A`, "-50,00", ""),
          row(`11/01/${year}`, `${label}-B`, "", "1000,00"),
          row(`12/03/${year}`, `${label}-C`, "-200,00", ""),
        ].join("\n") + "\n",
        "utf-8",
      ),
    });
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(
    page.getByRole("region", { name: "Import result" }).getByText("3 imported"),
  ).toBeVisible();

  try {
    await page.goto(`/year?year=${year}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Year", exact: true }),
    ).toBeVisible();

    // The headline says it in words, with the figures it comes from.
    const headline = page.getByRole("region", { name: "Year totals" });
    await expect(headline.getByText(`Saved in ${year}`)).toBeVisible();
    await expect(
      headline.getByText(exact(formatWholeCents(75000, "en"))),
    ).toBeVisible();
    await expect(headline.getByText("75% of your income")).toBeVisible();
    await expect(
      headline.getByText(exact(formatWholeCents(100000, "en"))),
    ).toBeVisible(); // Income
    await expect(
      headline.getByText(exact(formatWholeCents(25000, "en"))),
    ).toBeVisible(); // Spent

    // Best and toughest months link to that month on the Budget page.
    const best = headline.getByRole("link", { name: "January" });
    await expect(best).toHaveAttribute("href", `/budget?month=${year}-01`);
    await expect(best.locator("xpath=..")).toContainText(
      `Best month: January, ${formatWholeCents(95000, "en")} saved`,
    );
    const toughest = headline.getByRole("link", { name: "March" });
    await expect(toughest).toHaveAttribute("href", `/budget?month=${year}-03`);
    await expect(toughest.locator("xpath=..")).toContainText(
      `Toughest month: March, ${formatWholeCents(20000, "en")} more spent than earned`,
    );

    // Month by month: one bar link per month, labelled with its signed net.
    const bars = page.getByTestId("year-net-bars");
    await expect(
      bars.getByRole("link", {
        name: `January ${year}: ${formatSignedWholeCents(95000, "en")}`,
      }),
    ).toBeVisible();
    await expect(
      bars.getByRole("link", {
        name: `March ${year}: ${formatSignedWholeCents(-20000, "en")}`,
      }),
    ).toBeVisible();

    // The months list: the two months with data, newest first.
    const months = page.getByTestId("year-months").getByRole("listitem");
    await expect(months).toHaveCount(2);
    await expect(months.first()).toContainText("March");
    await expect(months.last()).toContainText("January");
    await expect(months.last()).toContainText(formatWholeCents(100000, "en"));

    // By category: Uncategorized, with its total and March as its biggest month.
    const uncategorized = page
      .getByTestId("year-categories")
      .getByRole("listitem")
      .filter({ hasText: "Uncategorized" });
    await expect(uncategorized).toHaveCount(1);
    await expect(uncategorized).toContainText(formatWholeCents(25000, "en"));
    await expect(uncategorized).toContainText(`Most spent in March`);

    // Where the money went: the whole year first, then March alone through the period sheet.
    const flow = page.getByRole("region", { name: "Where the money went" });
    await expect(
      page.getByRole("region", { name: "Where it came from" }),
    ).toBeVisible();
    await flow.getByRole("button", { name: /Whole year/ }).click();
    await page
      .getByRole("dialog", { name: "Period" })
      .getByRole("link", { name: `March ${year}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`flow=${year}-03$`));
    await expect(flow).toContainText(formatCents(20000, "en"));
    await expect(
      page.getByRole("region", { name: "Where it came from" }),
    ).toHaveCount(0);

    // With data, in the app's one (dark) theme.
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      blocking.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      ),
    ).toEqual([]);

    // The page never scrolls sideways on a phone, even a narrow one.
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/year?year=${year}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Year", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
  } finally {
    await undoImport(page, fileName);
  }
});
