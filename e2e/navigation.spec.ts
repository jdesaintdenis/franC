import {
  addMonths,
  currentMonth,
  formatMonthLabel,
} from "../src/lib/dashboard/month";

import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

// Both the bottom bar and the sidebar are a nav labelled "Main ...", but only one is ever displayed.
const mainNav = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: /^Main/ });

// The sections of /settings (the More page), in order, with the page each one opens.
const MORE_ROWS = [
  { name: /^Categories/, url: "/settings/categories", heading: "Categories" },
  { name: /^Rules/, url: "/settings/rules", heading: "Rules" },
  { name: /^Merchant/, url: "/settings/merchants", heading: /^Merchant/ },
  { name: /^Tags/, url: "/settings/tags", heading: "Tags" },
  {
    name: /^Bank categories/,
    url: "/settings/bank-categories",
    heading: "Bank categories",
  },
  { name: /^Export/, url: "/settings/export", heading: "Export" },
];

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("bottom bar: each entry reaches its page and is marked current", async ({
    page,
  }) => {
    const nav = mainNav(page);
    const entries = [
      { link: "Transactions", url: "/transactions", heading: "Transactions" },
      { link: "Accounts", url: "/accounts", heading: "Accounts" },
      { link: "Plan", url: "/budget", heading: "Plan" },
      { link: "More", url: "/settings", heading: "More" },
    ];
    for (const { link, url, heading } of entries) {
      await nav.getByRole("link", { name: new RegExp(`^${link}`) }).click();
      await expect(page).toHaveURL(url);
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expect(
        nav.getByRole("link", { name: new RegExp(`^${link}`) }),
      ).toHaveAttribute("aria-current", "page");
    }

    await nav.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL("/");
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Plan" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("Plan: rows reach Recurring, Next month and Year; sub-pages keep Plan current and go back to it", async ({
    page,
  }) => {
    const nav = mainNav(page);
    const more = page.getByRole("region", { name: "More", exact: true });

    await page.goto("/budget");
    await more.getByRole("link", { name: /^Regular payments/ }).click();
    await expect(page).toHaveURL("/recurring");
    await expect(
      page.getByRole("heading", { level: 1, name: "Regular payments" }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "Plan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.getByRole("link", { name: "Back to Plan" }).click();
    await expect(page).toHaveURL("/budget");

    await more.getByRole("link", { name: /^Next month/ }).click();
    await expect(page).toHaveURL("/budget/next-month");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: formatMonthLabel(addMonths(currentMonth(new Date()), 1), "en"),
      }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "Plan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.getByRole("link", { name: "Back to Plan" }).click();
    await expect(page).toHaveURL("/budget");

    await more.getByRole("link", { name: /^Year in review/ }).click();
    await expect(page).toHaveURL(/\/year/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Year", exact: true }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "Plan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.getByRole("link", { name: "Back to Plan" }).click();
    await expect(page).toHaveURL("/budget");

    // Budgets and Goals keep their /settings URLs but belong to Plan, not More.
    for (const url of ["/settings/budgets", "/settings/goals"]) {
      await page.goto(url);
      await expect(nav.getByRole("link", { name: "Plan" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(nav.getByRole("link", { name: "More" })).not.toHaveAttribute(
        "aria-current",
        "page",
      );
      await page.getByRole("link", { name: "Back to Plan" }).click();
      await expect(page).toHaveURL("/budget");
      await expect(
        page.getByRole("heading", { level: 1, name: "Plan" }),
      ).toBeVisible();
    }
  });

  test("Plan: the goals entry point reaches the goals page", async ({
    page,
  }) => {
    await page.goto("/budget");
    // "Manage" in the Goals section when a goal exists, otherwise the "Add a savings goal" row.
    await page
      .getByRole("link", { name: /^(Manage|Add a savings goal)/ })
      .click();
    await expect(page).toHaveURL("/settings/goals");
    await page.getByRole("link", { name: "Back to Plan" }).click();
    await expect(page).toHaveURL("/budget");
  });

  test("More: each row reaches its page and Back to More returns", async ({
    page,
  }) => {
    const nav = mainNav(page);
    const sections = page.getByRole("main");

    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { level: 1, name: "More" }),
    ).toBeVisible();
    // Budgets and Goals moved to Plan.
    await expect(
      sections.getByRole("link", { name: /^(Budgets|Goals)/ }),
    ).toHaveCount(0);

    for (const { name, url, heading } of MORE_ROWS) {
      await sections.getByRole("link", { name }).click();
      await expect(page).toHaveURL(url);
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
      await expect(nav.getByRole("link", { name: "More" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await page.getByRole("link", { name: "Back to More" }).click();
      await expect(page).toHaveURL("/settings");
      await expect(
        page.getByRole("heading", { level: 1, name: "More" }),
      ).toBeVisible();
    }
  });

  test("Review: Back to Transactions returns to the list", async ({ page }) => {
    await page.goto("/review");
    await page.getByRole("link", { name: "Back to Transactions" }).click();
    await expect(page).toHaveURL("/transactions");
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the bottom bar is hidden and the sidebar takes over", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(mainNav(page)).toHaveCount(1);

    const nav = mainNav(page);
    for (const label of ["Home", "Transactions", "Plan", "Accounts", "More"]) {
      await expect(
        nav.getByRole("link", { name: new RegExp(`^${label}`) }),
      ).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Recurring" })).toHaveCount(0);
  });

  test("each sidebar entry reaches its page and is marked current", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = mainNav(page);
    const entries = [
      { link: "Transactions", url: "/transactions", heading: "Transactions" },
      { link: "Plan", url: "/budget", heading: "Plan" },
      { link: "Accounts", url: "/accounts", heading: "Accounts" },
      { link: "More", url: "/settings", heading: "More" },
    ];
    for (const { link, url, heading } of entries) {
      await nav.getByRole("link", { name: new RegExp(`^${link}`) }).click();
      await expect(page).toHaveURL(url);
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
      await expect(
        nav.getByRole("link", { name: new RegExp(`^${link}`) }),
      ).toHaveAttribute("aria-current", "page");
    }

    await nav.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL("/");
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
