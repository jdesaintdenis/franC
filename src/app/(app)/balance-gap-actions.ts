"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import { acceptBalanceGap, restoreBalanceGap } from "@/db/queries/balance-gaps";
import { withActionErrors } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";
import { MAX_BALANCE_CENTS } from "@/lib/balance/input";

export type AcceptGapState =
  | { status: "ok"; checkpointId: string; previousCents: number }
  | { status: "error"; error: string };
export type RestoreGapState = { status: "ok" } | { status: "error"; error: string };

// The gap shows on Home and in the account sheet.
function revalidateGapPages() {
  for (const path of ["/", "/accounts"]) revalidatePath(path);
}

/** "Accept the bank's balance": a note on the latest bank checkpoint, not a transaction. */
export async function acceptBalanceGapAction(accountId: string): Promise<AcceptGapState> {
  const t = await getTranslations("dashboard.balanceGap");
  return withActionErrors(t("acceptFailed"), async (): Promise<AcceptGapState> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(accountId);
    if (!id.success) return { status: "error", error: t("notFound") };

    const result = await acceptBalanceGap(db, user.id, id.data);
    if (!result.ok) return { status: "error", error: t("notFound") };

    revalidateGapPages();
    return { status: "ok", checkpointId: result.checkpointId, previousCents: result.previousCents };
  });
}

const restoreSchema = z.object({
  checkpointId: z.uuid(),
  previousCents: z.number().int().min(-MAX_BALANCE_CENTS * 100).max(MAX_BALANCE_CENTS * 100),
});

/** Undo of the above. The snapshot comes from the client; `restoreBalanceGap` is scoped by user. */
export async function restoreBalanceGapAction(checkpointId: string, previousCents: number): Promise<RestoreGapState> {
  const t = await getTranslations("dashboard.balanceGap");
  return withActionErrors(t("undoFailed"), async (): Promise<RestoreGapState> => {
    const user = await requireUser();
    const input = restoreSchema.safeParse({ checkpointId, previousCents });
    if (!input.success) return { status: "error", error: t("notFound") };

    const result = await restoreBalanceGap(db, user.id, input.data.checkpointId, input.data.previousCents);
    if (!result.ok) return { status: "error", error: t("notFound") };

    revalidateGapPages();
    return { status: "ok" };
  });
}
