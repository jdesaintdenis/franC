import type { SplitPart } from "@/db/queries/splits";

import type { RemoveSplitActionResult, SaveSplitActionResult } from "./actions";
import type { SplitPatch } from "./split-editor";

interface SplitActions {
  saveSplitAction: (input: unknown) => Promise<SaveSplitActionResult>;
  removeSplitAction: (input: unknown) => Promise<RemoveSplitActionResult>;
}

/**
 * Puts a row's split back the way it was: the old parts, or no split at all when there were none.
 * Null when the server refuses (the row changed in the meantime).
 */
export async function restoreSplitParts(
  transactionId: string,
  previous: { parts: SplitPart[] } | null,
  actions: SplitActions,
): Promise<SplitPatch | null> {
  if (previous === null) {
    const result = await actions.removeSplitAction({ transactionId });
    if (result.status === "error") return null;
    return { id: transactionId, split: null, category: result.category, categorySource: result.categorySource };
  }
  const result = await actions.saveSplitAction({
    transactionId,
    parts: previous.parts.map((p) => ({ categoryId: p.category?.id, amountCents: p.amountCents })),
  });
  if (result.status === "error") return null;
  return { id: transactionId, split: { parts: result.parts } };
}
