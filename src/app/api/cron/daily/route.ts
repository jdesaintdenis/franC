import { NextResponse } from "next/server";
import postgres from "postgres";

import { dumpDatabase } from "@/db/backup";
import { db } from "@/db/client";
import { recordBackupRun } from "@/db/queries/backup-status";
import { bankSyncStore, listDailySyncTargets, recordAttempt } from "@/db/queries/bank-sync";
import { refreshDerivedData } from "@/lib/actions/refresh-derived";
import { runDailySync } from "@/lib/bank-sync/daily";
import { bankSync, isBankSyncAllowed } from "@/lib/bank-sync/server";
import { syncAccount } from "@/lib/bank-sync/sync";
import { currentDate } from "@/lib/dashboard/month";
import { parseVapidConfig } from "@/lib/push/config";
import { backupLogLine, isBackupConfigured, runDailyBackup, type BackupResult } from "@/lib/backup/daily";
import { deleteBackups, listBackups, uploadBackup } from "@/lib/backup/blob";
import { isAuthorizedCron } from "@/lib/push/cron-auth";
import { runBankHealthPush, runImportReminders } from "@/lib/push/run-reminders";
import { createWebPushSender } from "@/lib/push/web-push-sender";

export const dynamic = "force-dynamic";
// Bank sync runs one link after another; one owner with a few accounts fits well within a minute.
// ponytail: sequential, batch per connection if it ever times out.
export const maxDuration = 60;

// Uses the dedicated read-only backup URL when set; the dump runs in a READ ONLY transaction either way.
async function backupNow(): Promise<BackupResult> {
  const sql = postgres((process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL) as string, { max: 1 });
  try {
    return await runDailyBackup({
      recipient: process.env.BACKUP_AGE_RECIPIENT as string,
      now: () => new Date(),
      dump: () => dumpDatabase(sql),
      upload: uploadBackup,
      list: listBackups,
      remove: deleteBackups,
      record: (input) => recordBackupRun(db, input),
    });
  } catch {
    // Only the status write can throw here; the run still must not stop the bank sync below.
    return { status: "failed", step: "dump", code: null };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Daily job (Vercel Cron at 07:00 UTC, or curl from any cron): encrypted backup, then bank sync, then
 * the import-reminder push, then the bank health push. Missing Backup, Enable Banking or VAPID settings
 * only skip their part. The backup goes first so a sync problem never skips it; a failed backup makes
 * the response a 500 so the cron run shows as failed. Logs counts only, never users, endpoints or data.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  if (!isAuthorizedCron(request.headers.get("authorization"), secret)) {
    return new NextResponse(null, { status: 401 });
  }

  const backup: BackupResult = isBackupConfigured(process.env) ? await backupNow() : { status: "not-configured" };
  console.info(`backup cron: ${backupLogLine(backup)}`);
  const httpStatus = backup.status === "failed" ? 500 : 200;

  const runStartedAt = new Date();
  const today = currentDate(runStartedAt);

  let syncCounts = null;
  const bank = bankSync();
  if (bank) {
    const store = bankSyncStore(db);
    syncCounts = await runDailySync({
      targets: await listDailySyncTargets(db, runStartedAt),
      isAllowed: isBankSyncAllowed,
      // No PSU headers: this is the unattended fetch the bank limits to a few a day.
      sync: (userId, linkId) => syncAccount({ client: bank.client, store, now: new Date() }, userId, linkId),
      recordAttempt: (userId, linkId, input) => recordAttempt(db, userId, linkId, input),
      refreshDerivedData: async (userId) => void (await refreshDerivedData(userId, "import")),
      now: () => new Date(),
    });
    console.info(
      `bank-sync cron: links=${syncCounts.links} synced=${syncCounts.synced} inserted=${syncCounts.inserted} failed=${syncCounts.failed} rateLimited=${syncCounts.rateLimited}`,
    );
  }

  const vapid = parseVapidConfig(process.env);
  if (!vapid) return NextResponse.json({ status: "push-not-configured", backup, sync: syncCounts }, { status: httpStatus });

  const send = createWebPushSender(vapid);
  const reminder = await runImportReminders({ database: db, send, today });
  console.info(`import-reminder cron: sent=${reminder.sent} failed=${reminder.failed} removed=${reminder.removed}`);
  const health = await runBankHealthPush({ database: db, send, isAllowed: isBankSyncAllowed, today, runStartedAt });
  console.info(`bank-health cron: sent=${health.sent} failed=${health.failed} removed=${health.removed}`);
  return NextResponse.json({ status: "ok", backup, sync: syncCounts, reminder, health }, { status: httpStatus });
}
