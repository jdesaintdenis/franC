import type { RecurringListItem } from "@/db/queries/recurring";
import { filtersToSearchParams } from "@/lib/transactions/filters";

/** The item's transactions: a named merchant links by id (its name would also match unrelated labels). */
export function transactionsHref(item: Pick<RecurringListItem, "merchantId" | "merchantKey" | "accountId">): string {
  // The item belongs to one account, so its transactions list is scoped to it too.
  const params = filtersToSearchParams({
    ...(item.merchantId ? { merchant: item.merchantId } : { q: item.merchantKey }),
    direction: "all",
    account: item.accountId,
  });
  return `/transactions?${params.toString()}`;
}
