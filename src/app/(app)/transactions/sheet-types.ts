import type { SuggestionCreated } from "@/components/rule-suggestion-line";
import type { TagRef } from "@/db/queries/tags";
import type { TransactionListItem } from "@/db/queries/transactions";
import type { CategoryOption as CategoryOptionData } from "@/lib/categorize/hierarchy";

import type { CategorizeResult } from "./actions";

/** Picker option in tree order; `label` is "Parent > Child" for subcategories. */
export type CategoryOption = CategoryOptionData;

/** Which part of the sheet to open on; undefined opens the main view. */
export type SheetSection = "split" | "transfer" | "rename" | "note";

/** The note, tags or "paid with next month's money" of a loaded row changed; only the given fields are patched. */
export interface NoteTagsPatch {
  id: string;
  note?: string | null;
  tags?: TagRef[];
  /** "Paid with next month's money" was switched (Slice 79). */
  paidFromNextMonth?: boolean;
}

export type CategorizedResult = Extract<CategorizeResult, { status: "done" }>;

/** A category was put back by Undo; rows patch these fields (and `reviewed`) in place. */
export interface CategoryRestore {
  id: string;
  category: TransactionListItem["category"];
  categorySource: TransactionListItem["categorySource"];
  reviewed: boolean;
}

/** A rule was created (quick create or Adjust): `byCategory` lists the rows it categorized. */
export type RuleCreated = SuggestionCreated;
