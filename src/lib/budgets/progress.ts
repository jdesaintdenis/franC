import type { BudgetCharge } from "./charges";
import { onPaceToOverspend, type PaceContext } from "./pace";

export interface BudgetRow {
  categoryId: string;
  name: string;
  color: string;
  /** A top-level category's own icon; null for a subcategory. */
  icon?: string | null;
  parentId: string | null;
  parentName: string | null;
  parentColor?: string | null;
  budgetCents: number;
  /** Outflows of the month, positive. Already rolled up (own + subcategories) for top-level categories. */
  spentCents: number;
  /** Part of spentCents that is charges linked to a recurring item, rolled up the same way. */
  recurringSpentCents?: number;
  /** Carried in from earlier months when rollover is on (negative = overspent); null or absent otherwise. */
  carryCents?: number | null;
}

export type BudgetStatus = "ok" | "near" | "over";

export interface BudgetEntry {
  categoryId: string;
  name: string;
  color: string;
  icon: string | null;
  /** Set for subcategory budgets; the UI labels a standalone one "Parent > Name". */
  parentId: string | null;
  parentName: string | null;
  budgetCents: number;
  /** Null when rollover is off (or starts after this month). */
  carryCents: number | null;
  /** budget + carry: what the month may spend. Can be 0 or negative after overspending. */
  availableCents: number;
  spentCents: number;
  remainingCents: number;
  overCents: number;
  status: BudgetStatus;
  /** Not over yet, but on track to be by month end (current month only, see pace.ts). */
  onPace: boolean;
  /** The regular payments of this budget's categories (paid and still due); set by `attachCharges`. */
  charges?: BudgetCharge[];
}

export interface BudgetItem extends BudgetEntry {
  /** Subcategory budgets inside this (budgeted) parent. Empty for standalone entries. */
  children: BudgetEntry[];
  /** Sum of the children's budgets. */
  childrenBudgetCents: number;
  /** True when the children's budgets add up to more than this parent's budget. */
  subcategoriesExceedParent: boolean;
}

export interface BudgetTotals {
  /**
   * Available amounts (budget + carry) of parent budgets plus standalone subcategory budgets; a
   * subcategory budget inside a budgeted parent is not added.
   */
  budgetedCents: number;
  /** Spending of the same entries (children are already inside their parent's spending). */
  spentCents: number;
  /** Every budgeted category over its budget, children included. */
  overCount: number;
}

export interface BudgetOverview {
  items: BudgetItem[];
  totals: BudgetTotals;
}

// Integer math only: near = at least 90% used.
function statusOf(spent: number, budget: number): BudgetStatus {
  if (spent > budget) return "over";
  if (spent * 10 >= budget * 9) return "near";
  return "ok";
}

function toEntry(row: BudgetRow, pace: PaceContext | undefined): BudgetEntry {
  const { budgetCents: budget, spentCents: spent } = row;
  const carry = row.carryCents ?? null;
  const available = budget + (carry ?? 0);
  const onPace =
    pace !== undefined &&
    onPaceToOverspend(
      {
        spentCents: spent,
        recurringSpentCents: row.recurringSpentCents ?? 0,
        billsDueCents: pace.billsDueCents?.get(row.categoryId) ?? 0,
        availableCents: available,
      },
      pace,
    );
  return {
    categoryId: row.categoryId,
    name: row.name,
    color: row.color,
    icon: row.icon ?? null,
    parentId: row.parentId,
    parentName: row.parentName,
    budgetCents: budget,
    carryCents: carry,
    availableCents: available,
    spentCents: spent,
    remainingCents: Math.max(0, available - spent),
    overCents: Math.max(0, spent - available),
    status: statusOf(spent, available),
    onPace,
  };
}

function rank(entry: BudgetEntry): number {
  if (entry.status === "over") return 0;
  return entry.onPace ? 1 : 2;
}

// Over first, then on pace to go over, then share of the available amount used (descending),
// then name. The cross-product is done in BigInt because cents * cents can pass
// Number.MAX_SAFE_INTEGER; an available amount of 0 or less counts as 1 cent so the order holds.
function compareEntries(a: BudgetEntry, b: BudgetEntry): number {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const left = BigInt(a.spentCents) * BigInt(Math.max(1, b.availableCents));
  const right = BigInt(b.spentCents) * BigInt(Math.max(1, a.availableCents));
  if (left !== right) return left > right ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** `pace` is given for the current month only: past months are over, pace means nothing there. */
export function buildBudgetOverview(rows: readonly BudgetRow[], pace?: PaceContext): BudgetOverview {
  const budgetedIds = new Set(rows.map((r) => r.categoryId));
  const childrenByParent = new Map<string, BudgetEntry[]>();
  const items: BudgetItem[] = [];

  for (const row of rows) {
    if (row.parentId !== null && budgetedIds.has(row.parentId)) {
      const siblings = childrenByParent.get(row.parentId) ?? [];
      siblings.push(toEntry(row, pace));
      childrenByParent.set(row.parentId, siblings);
    }
  }

  for (const row of rows) {
    if (row.parentId !== null && budgetedIds.has(row.parentId)) continue;
    const entry = toEntry(row, pace);
    const children = (childrenByParent.get(row.categoryId) ?? []).sort(compareEntries);
    const childrenBudgetCents = children.reduce((sum, c) => sum + c.budgetCents, 0);
    items.push({
      ...entry,
      children,
      childrenBudgetCents,
      subcategoriesExceedParent: childrenBudgetCents > entry.budgetCents,
    });
  }
  items.sort(compareEntries);

  const totals: BudgetTotals = { budgetedCents: 0, spentCents: 0, overCount: 0 };
  for (const item of items) {
    totals.budgetedCents += item.availableCents;
    totals.spentCents += item.spentCents;
    if (item.status === "over") totals.overCount += 1;
    for (const child of item.children) if (child.status === "over") totals.overCount += 1;
  }
  return { items, totals };
}

/** The overview with each entry's regular payments attached; order and totals are unchanged. */
export function attachCharges(overview: BudgetOverview, byEntry: ReadonlyMap<string, BudgetCharge[]>): BudgetOverview {
  const withCharges = <T extends BudgetEntry>(entry: T): T => ({ ...entry, charges: byEntry.get(entry.categoryId) ?? [] });
  return {
    ...overview,
    items: overview.items.map((item) => ({ ...withCharges(item), children: item.children.map(withCharges) })),
  };
}
