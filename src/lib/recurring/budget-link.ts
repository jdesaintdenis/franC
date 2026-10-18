import { coveringBudgetId } from "../safe-to-spend/compute";

/** Where a regular payment's sheet sends its "budget" link. */
export interface RecurringBudgetLink {
  /** The budgeted category covering the payment, or its own category when none has a budget yet. */
  categoryId: string;
  categoryName: string;
  exists: boolean;
  href: string;
}

/**
 * The budget a regular outflow belongs to: its category's (or parent's) budget when there is one,
 * else a new budget on its own category, pre-filled with the monthly amount. Null without a
 * category or for income: there is nothing to budget.
 */
export function recurringBudgetLink(
  item: { categoryId: string | null; typicalAmountCents: number; interval: string },
  categories: readonly { id: string; name: string; parentId: string | null }[],
  budgetedIds: ReadonlySet<string>,
): RecurringBudgetLink | null {
  if (!item.categoryId || item.typicalAmountCents >= 0) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const covering = coveringBudgetId(item.categoryId, parentOf, budgetedIds);
  const category = byId.get(covering ?? item.categoryId);
  if (!category) return null;
  const params = new URLSearchParams({ edit: category.id });
  // Only a monthly payment's amount is a month's worth; other rhythms leave the usual suggestion.
  if (!covering && item.interval === "monthly") params.set("amount", String(-item.typicalAmountCents));
  return { categoryId: category.id, categoryName: category.name, exists: covering !== null, href: `/settings/budgets?${params}` };
}
