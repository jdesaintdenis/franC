import type { OpenPriceAlert } from "@/db/queries/price-alerts";
import type { RecurringHistoryEntry, RecurringListItem } from "@/db/queries/recurring";
import type { RecurringBudgetLink } from "@/lib/recurring/budget-link";

/** What the avatar needs of the item's category (the latest charge's). */
export interface AvatarCategory {
  color: string;
  icon: string | null;
  parentName: string | null;
}

/** A list item with everything its row and sheet show, so the sheet opens without a request. */
export interface RecurringViewItem extends RecurringListItem {
  /** The open price alert, when `hasPriceAlert`. */
  alert: OpenPriceAlert | null;
  /** The last charges, newest first. */
  history: RecurringHistoryEntry[];
  avatarCategory: AvatarCategory | null;
  /** The budget the sheet links to (create or open); null for income or without a category. */
  budget: RecurringBudgetLink | null;
}
