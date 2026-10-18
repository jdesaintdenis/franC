import { sortItems, type RecurringSort, type ViewItem } from "./list-view";

export interface SectionItem extends ViewItem {
  hasPriceAlert?: boolean;
  possiblyCancelled?: boolean;
}

export interface Sections<T> {
  bills: T[];
  income: T[];
  ended: T[];
  dismissed: T[];
}

export const needsAttention = (i: SectionItem) => i.hasPriceAlert === true || i.possiblyCancelled === true;

/**
 * Running outflows (bills) and inflows (income), each with items that need a look
 * (open price alert, "Cancelled?" flag) first, then the chosen sort. Ended and dismissed
 * items keep the order they came in.
 */
export function splitSections<T extends SectionItem>(items: readonly T[], sort: RecurringSort): Sections<T> {
  const running = (out: boolean) =>
    items.filter(
      (i) => (i.status === "confirmed" || i.status === "detected") && (i.typicalAmountCents < 0) === out,
    );
  const order = (list: T[]): T[] => {
    const sorted = sortItems(list, sort);
    return [...sorted.filter(needsAttention), ...sorted.filter((i) => !needsAttention(i))];
  };
  return {
    bills: order(running(true)),
    income: order(running(false)),
    ended: items.filter((i) => i.status === "ended"),
    dismissed: items.filter((i) => i.status === "dismissed"),
  };
}

/** Rows a folded running list shows: `fold`, or every item that needs a look when more do (they come first). */
export function foldedCount(items: readonly SectionItem[], fold: number): number {
  const attention = items.filter(needsAttention).length;
  return Math.min(items.length, Math.max(fold, attention));
}
