import { currentDate } from "../dashboard/month";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Reconnect is offered once the consent ends within this many days. */
export const RECONNECT_WITHIN_DAYS = 14;
/** Opening franC syncs again when an imported account's data is older than this. */
export const SYNC_ON_OPEN_MS = 2 * HOUR_MS;

/** What health needs from a bank account link. */
export type HealthLink = {
  /** Linked and feeding a franC account: the only ones that sync. */
  imported: boolean;
  lastSyncedAt: Date | null;
  lastError: string | null;
  failingSince: Date | null;
};

export type ConnectionHealth =
  | { kind: "reconnect"; /** ISO day the consent ends (Paris). */ expiresOn: string; expired: boolean; /** Why: the consent ends soon, has ended, or the bank refused the session while it is still valid. */ reason: "expiring" | "expired" | "refused" }
  | { kind: "failing"; since: Date }
  | { kind: "rateLimited" }
  | { kind: "ok"; syncedAt: Date }
  | { kind: "never" };

/** How one connection is doing, most urgent first (reconnect beats failing beats the rate limit). */
export function connectionHealth(input: {
  status: string;
  validUntil: Date;
  links: readonly HealthLink[];
  now: Date;
}): ConnectionHealth {
  const { status, validUntil, now } = input;
  const links = input.links.filter((l) => l.imported);
  const ended = status === "expired" || validUntil.getTime() <= now.getTime();
  const soon = validUntil.getTime() - now.getTime() <= RECONNECT_WITHIN_DAYS * DAY_MS;
  if (ended || soon || links.some((l) => l.lastError === "unauthorized")) {
    const reason = ended ? "expired" : soon ? "expiring" : "refused";
    return { kind: "reconnect", expiresOn: currentDate(validUntil), expired: ended, reason };
  }

  const failing = links.flatMap((l) => (l.failingSince ? [l.failingSince] : []));
  if (failing.length > 0) return { kind: "failing", since: new Date(Math.min(...failing.map((d) => d.getTime()))) };
  if (links.some((l) => l.lastError === "rate_limited")) return { kind: "rateLimited" };

  const synced = links.map((l) => l.lastSyncedAt);
  if (synced.length === 0 || synced.some((d) => d === null)) return { kind: "never" };
  return { kind: "ok", syncedAt: new Date(Math.min(...synced.map((d) => d!.getTime()))) };
}

/** True when some imported link was never synced or last synced over 2 hours ago. */
export function syncDue(links: ReadonlyArray<Pick<HealthLink, "imported" | "lastSyncedAt">>, now: Date): boolean {
  return links.some(
    (l) => l.imported && (l.lastSyncedAt === null || now.getTime() - l.lastSyncedAt.getTime() > SYNC_ON_OPEN_MS),
  );
}
