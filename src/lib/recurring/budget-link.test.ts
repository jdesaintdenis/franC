import { describe, expect, it } from "vitest";

import { recurringBudgetLink } from "./budget-link";

const categories = [
  { id: "home", name: "Logement", parentId: null },
  { id: "rent", name: "Loyer", parentId: "home" },
  { id: "gym", name: "Sport", parentId: null },
];
const item = (categoryId: string | null, typicalAmountCents = -12399, interval = "monthly") => ({ categoryId, typicalAmountCents, interval });

describe("recurringBudgetLink", () => {
  it("offers a new budget on the payment's category, pre-filled with its monthly amount", () => {
    expect(recurringBudgetLink(item("gym"), categories, new Set())).toEqual({
      categoryId: "gym",
      categoryName: "Sport",
      exists: false,
      href: "/settings/budgets?edit=gym&amount=12399",
    });
  });

  it("does not pre-fill a payment that is not monthly", () => {
    expect(recurringBudgetLink(item("gym", -12000, "yearly"), categories, new Set())?.href).toBe("/settings/budgets?edit=gym");
  });

  it("opens the existing budget, the parent's for a subcategory", () => {
    expect(recurringBudgetLink(item("gym"), categories, new Set(["gym"]))).toMatchObject({ exists: true, href: "/settings/budgets?edit=gym" });
    expect(recurringBudgetLink(item("rent"), categories, new Set(["home"]))).toMatchObject({ categoryId: "home", categoryName: "Logement", exists: true });
  });

  it("has nothing to offer for income or an uncategorized payment", () => {
    expect(recurringBudgetLink(item(null), categories, new Set())).toBeNull();
    expect(recurringBudgetLink(item("gym", 5000), categories, new Set())).toBeNull();
  });
});
