import type { SyncResult } from "./sync";

export type DailySyncTarget = { userId: string; email: string; linkId: string };

export interface DailySyncCounts {
  links: number;
  synced: number;
  inserted: number;
  failed: number;
  rateLimited: number;
}

/**
 * The 07:00 bank sync: every imported link of an active connection, one after another, with no PSU
 * headers (so it counts as one of the bank's unattended fetches). Everything is injected so it is
 * tested with fakes. Counts only; nothing about the data is logged.
 */
export async function runDailySync(deps: {
  targets: readonly DailySyncTarget[];
  isAllowed: (email: string) => boolean;
  sync: (userId: string, linkId: string) => Promise<SyncResult>;
  recordAttempt: (userId: string, linkId: string, input: { at: Date; error: string | null }) => Promise<void>;
  refreshDerivedData: (userId: string) => Promise<void>;
  now: () => Date;
}): Promise<DailySyncCounts> {
  const counts: DailySyncCounts = { links: 0, synced: 0, inserted: 0, failed: 0, rateLimited: 0 };
  const withRows = new Set<string>();

  for (const { userId, email, linkId } of deps.targets) {
    if (!deps.isAllowed(email)) continue;
    counts.links += 1;
    let result: SyncResult;
    try {
      result = await deps.sync(userId, linkId);
    } catch {
      // An unexpected throw on one link must not stop the others; it counts as a failed attempt.
      result = { ok: false, error: "network" };
    }
    if (result.ok) {
      counts.synced += 1;
      counts.inserted += result.inserted;
      if (result.inserted > 0) withRows.add(userId);
    } else if (result.error === "linkNotFound") {
      counts.failed += 1;
      continue;
    } else {
      if (result.error === "rate_limited") counts.rateLimited += 1;
      else counts.failed += 1;
    }
    await deps.recordAttempt(userId, linkId, { at: deps.now(), error: result.ok ? null : result.error });
  }

  for (const userId of withRows) await deps.refreshDerivedData(userId);
  return counts;
}
