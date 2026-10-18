import type { ConnectionHealth } from "./health";

/** What Home's sync line says, from the health of the connections that import something. */
export type SyncLine =
  | { kind: "reconnect" }
  | { kind: "failing"; since: Date }
  | { kind: "rateLimited" }
  | { kind: "synced"; at: Date }
  | { kind: "never" };

/** The most urgent state wins; null when no connection imports anything (the line isn't shown). */
export function syncLine(healths: readonly ConnectionHealth[]): SyncLine | null {
  if (healths.length === 0) return null;
  if (healths.some((h) => h.kind === "reconnect")) return { kind: "reconnect" };
  const failing = healths.flatMap((h) => (h.kind === "failing" ? [h.since] : []));
  if (failing.length > 0) return { kind: "failing", since: new Date(Math.min(...failing.map((d) => d.getTime()))) };
  if (healths.some((h) => h.kind === "rateLimited")) return { kind: "rateLimited" };
  const synced = healths.flatMap((h) => (h.kind === "ok" ? [h.syncedAt] : []));
  if (synced.length < healths.length) return { kind: "never" };
  return { kind: "synced", at: new Date(Math.min(...synced.map((d) => d.getTime()))) };
}
