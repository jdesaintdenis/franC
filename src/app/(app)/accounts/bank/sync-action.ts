"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { db } from "@/db/client";
import { bankSyncStore, listSyncableLinks, recordAttempt } from "@/db/queries/bank-sync";
import { withActionErrors, withActionErrorState } from "@/lib/actions/safe-action";
import { refreshDerivedData } from "@/lib/actions/refresh-derived";
import { requireUser } from "@/lib/auth/session";
import { BANK_CONNECTION_PATH, bankSyncFor, psuFromHeaders } from "@/lib/bank-sync/server";
import { syncDue } from "@/lib/bank-sync/health";
import { syncAccount, type SyncResult } from "@/lib/bank-sync/sync";

export type SyncState =
  | { status: "ok"; inserted: number; errors: number }
  | { status: "error"; error: string };

const linkIdsSchema = z.array(z.uuid()).min(1).max(20);

/**
 * Sync now for one or more linked bank accounts (a connection card syncs all of its own). Runs them
 * one after the other and stops at the first failure: the bank's error is about the connection.
 */
export async function syncNowAction(linkIds: unknown): Promise<SyncState> {
  const t = await getTranslations("settings.bankConnection.sync");
  return withActionErrors(t("errors.failed"), async (): Promise<SyncState> => {
    const user = await requireUser();
    const sync = bankSyncFor(user.email);
    if (!sync) return { status: "error", error: t("errors.not_configured") };
    const parsed = linkIdsSchema.safeParse(linkIds);
    if (!parsed.success) return { status: "error", error: t("errors.linkNotFound") };

    const store = bankSyncStore(db);
    const psu = psuFromHeaders(await headers()) ?? undefined;
    let inserted = 0;
    let errors = 0;
    let failure: Extract<SyncResult, { ok: false }>["error"] | null = null;
    for (const linkId of new Set(parsed.data)) {
      const at = new Date();
      const result = await syncAccount({ client: sync.client, store, now: at, psu }, user.id, linkId);
      // Feeds the connection's status line, like the daily job's attempts do.
      if (result.ok || result.error !== "linkNotFound") {
        await recordAttempt(db, user.id, linkId, { at, error: result.ok ? null : result.error });
      }
      if (!result.ok) {
        failure = result.error;
        break;
      }
      inserted += result.inserted;
      errors += result.errors;
    }

    // Transfers and recurring items see the new rows, as after a CSV import.
    if (inserted > 0) await refreshDerivedData(user.id, "import");
    for (const path of [BANK_CONNECTION_PATH, "/import", "/transactions", "/review", "/recurring", "/"]) revalidatePath(path);
    if (failure) return { status: "error", error: t(`errors.${failure}`) };
    return { status: "ok", inserted, errors };
  });
}

export type SyncOnOpenState = { ran: false } | { ran: true; inserted: number };

/**
 * Background sync when franC opens: syncs the imported links whose last sync is over 2 hours old (never-synced links wait for Sync now).
 * The 2 hours are re-checked here, so several tabs or a reload loop never make more than one sync.
 * Sends the PSU headers like Sync now (the bank counts it as attended). Failures only show through
 * the connection's status, never as a message.
 */
export async function syncOnOpenAction(): Promise<SyncOnOpenState> {
  return withActionErrorState(
    "sync on open failed",
    async (): Promise<SyncOnOpenState> => {
      const user = await requireUser();
      const sync = bankSyncFor(user.email);
      if (!sync) return { ran: false };

      const now = new Date();
      // A link never synced waits for its first Sync now: the start date can still be changed until then,
      // and the first sync brings in up to 90 days, which is the user's call. Only refreshes sync on open.
      const due = (await listSyncableLinks(db, user.id)).filter(
        (l) => l.lastSyncedAt !== null && syncDue([{ imported: true, lastSyncedAt: l.lastSyncedAt }], now),
      );
      if (due.length === 0) return { ran: false };

      const store = bankSyncStore(db);
      const psu = psuFromHeaders(await headers()) ?? undefined;
      let inserted = 0;
      for (const { id: linkId } of due) {
        const at = new Date();
        const result = await syncAccount({ client: sync.client, store, now: at, psu }, user.id, linkId);
        if (result.ok || result.error !== "linkNotFound") {
          await recordAttempt(db, user.id, linkId, { at, error: result.ok ? null : result.error });
        }
        if (result.ok) inserted += result.inserted;
      }
      if (inserted > 0) {
        await refreshDerivedData(user.id, "import");
        for (const path of [BANK_CONNECTION_PATH, "/import", "/transactions", "/review", "/recurring", "/"]) revalidatePath(path);
      }
      return { ran: true, inserted };
    },
    { ran: false } as SyncOnOpenState,
  );
}
