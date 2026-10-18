"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import { deleteBankConnection, saveBankLinks } from "@/db/queries/bank-connections";
import { withActionErrors } from "@/lib/actions/safe-action";
import { requireUser } from "@/lib/auth/session";
import { BankSyncError } from "@/lib/bank-sync/errors";
import { sortBanks } from "@/lib/bank-sync/ordering";
import { BANK_CONNECTION_PATH, bankSync, bankSyncFor } from "@/lib/bank-sync/server";
import { clampSyncFrom } from "@/lib/bank-sync/window";
import { currentDate } from "@/lib/dashboard/month";

export type BankOption = { name: string; country: string };
export type BanksState = { status: "ok"; banks: BankOption[] } | { status: "error"; error: string };
export type ActionState = { status: "ok" } | { status: "error"; error: string };

const COUNTRY = "FR";

/** The banks offered in the picker, Caisse d'Épargne first. Fetched when the sheet opens. */
export async function listBanksAction(): Promise<BanksState> {
  const t = await getTranslations("settings.bankConnection");
  return withActionErrors(t("errors.banksFailed"), async (): Promise<BanksState> => {
    const user = await requireUser();
    const sync = bankSyncFor(user.email);
    if (!sync) return { status: "error", error: t("errors.notConfigured") };
    try {
      const banks = await sync.client.getAspsps(COUNTRY);
      return { status: "ok", banks: sortBanks(banks).map((b) => ({ name: b.name, country: b.country })) };
    } catch (error) {
      if (error instanceof BankSyncError) return { status: "error", error: t("errors.banksFailed") };
      throw error;
    }
  });
}

const choiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), accountId: z.uuid() }),
  z.object({ kind: z.literal("new"), name: z.string().max(200) }),
  z.object({ kind: z.literal("skip") }),
]);
const linksSchema = z.object({
  connectionId: z.uuid(),
  choices: z.array(z.object({ linkId: z.uuid(), choice: choiceSchema, syncFrom: z.iso.date().optional() })).min(1).max(50),
});

function revalidateAll() {
  for (const path of [BANK_CONNECTION_PATH, "/accounts", "/import", "/transactions", "/"]) revalidatePath(path);
}

export async function saveLinksAction(input: unknown): Promise<ActionState> {
  const t = await getTranslations("settings.bankConnection");
  return withActionErrors(t("errors.saveFailed"), async (): Promise<ActionState> => {
    const user = await requireUser();
    const parsed = linksSchema.safeParse(input);
    if (!parsed.success) return { status: "error", error: t("errors.notFound") };
    // The form's limits are a convenience: the bank gives 90 days at most, so clamp here too.
    const today = currentDate(new Date());
    const choices = parsed.data.choices.map((c) => ({
      ...c,
      syncFrom: c.syncFrom === undefined ? undefined : clampSyncFrom(today, c.syncFrom),
    }));
    const result = await saveBankLinks(db, user.id, parsed.data.connectionId, choices);
    if (!result.ok) return { status: "error", error: t(`errors.${result.error}`) };
    revalidateAll();
    return { status: "ok" };
  });
}

/** Disconnects: ends the session at Enable Banking (best effort) and forgets it. Data stays. */
export async function disconnectAction(connectionId: unknown): Promise<ActionState> {
  const t = await getTranslations("settings.bankConnection");
  return withActionErrors(t("errors.disconnectFailed"), async (): Promise<ActionState> => {
    const user = await requireUser();
    const id = z.uuid().safeParse(connectionId);
    if (!id.success) return { status: "error", error: t("errors.notFound") };
    const deleted = await deleteBankConnection(db, user.id, id.data);
    if (!deleted) return { status: "error", error: t("errors.notFound") };
    const sync = bankSync();
    if (sync && deleted.sessionId) {
      // The consent also expires on its own; a failure here must not keep the user connected.
      await sync.client.deleteSession(deleted.sessionId).catch(() => undefined);
    }
    revalidateAll();
    return { status: "ok" };
  });
}
