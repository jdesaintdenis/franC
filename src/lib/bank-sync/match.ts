import { daysBetween } from "../recurring/dates";

/** Where a row came from: a CSV upload or a bank sync. */
export type Side = "csv" | "sync";

/** Days either way within which a same-amount row from the other side may be the same purchase. */
export const MATCH_WINDOW_DAYS = 3;

export type Incoming = {
  date: string;
  amountCents: number;
  dedupeHash: string;
  occurrenceIndex: number;
  externalId: string | null;
};

/** An identity already merged into a kept row (a `transaction_matches` row). */
export type MatchedIdentity = {
  source: Side;
  dedupeHash: string;
  occurrenceIndex: number;
  externalId: string | null;
};

export type Existing = {
  id: string;
  date: string;
  amountCents: number;
  /** "manual": added by hand (Slice 56), or created by franC; never a candidate of the other side. */
  source: Side | "manual";
  /** Added by hand and still waiting for the bank row that will take it over. */
  awaitingBank: boolean;
  externalId: string | null;
  dedupeHash: string;
  occurrenceIndex: number;
  matched: readonly MatchedIdentity[];
};

export type Decision =
  /** Brand new: insert. */
  | { kind: "insert" }
  /**
   * Same bank id or same hash and occurrence as a known row: nothing to insert. `link` is true when
   * the target is a row of the other side not yet linked to this one (a CSV row and a synced row
   * sharing a hash): the identity is then recorded on it, so the row cannot absorb a second purchase later.
   */
  | { kind: "duplicate"; targetId: string; link: boolean }
  /** Same purchase as one row of the other side: remember the identity on it, insert nothing. */
  | { kind: "merge"; targetId: string }
  /** Several rows could be the same purchase: insert, and let the user decide. */
  | { kind: "possible"; candidateIds: string[] }
  /** A row added by hand and waiting for the bank: it becomes this row; nothing is inserted. */
  | { kind: "adopt"; targetId: string };

const hashKey = (hash: string, index: number) => `${hash}:${index}`;

function isCandidate(side: Side, row: Existing): boolean {
  if (row.source === "manual") return false;
  // A row already linked to the incoming side is a different purchase.
  // Ignored rows are ordinary candidates on purpose: an ignored duplicate must stay ignored,
  // so it has to absorb the incoming row instead of letting it back in.
  if (side === "sync") {
    return row.source === "csv" && row.externalId === null && !row.matched.some((m) => m.source === "sync");
  }
  return row.source === "sync" && !row.matched.some((m) => m.source === "csv");
}

/**
 * Decides, for each incoming row of one batch, whether it is new, already known, the same purchase
 * as a row from the other side, or possibly so. Pure: the caller loads `existing` (the account's rows
 * that can matter) and applies the decisions. Result `i` belongs to `incoming[i]`.
 *
 * Exact passes (bank id, then hash + occurrence, against rows and merged identities) come first. The
 * fuzzy pass handles the rest: same amount, dates within ±3 days, rows of the other side only, and
 * each candidate absorbs at most one incoming row (two existing €5.88 absorb two incoming ones).
 * A row that would be inserted may instead take over a row added by hand and waiting for the bank
 * (same amount, ±3 days, one candidate or one on the same date); the other side always comes first.
 */
export function matchIncoming(
  side: Side,
  incoming: readonly Incoming[],
  existing: readonly Existing[],
): Decision[] {
  const byExternalId = new Map<string, string>();
  const byHash = new Map<string, string>();
  const byId = new Map(existing.map((row) => [row.id, row]));
  for (const row of existing) {
    if (row.externalId !== null) byExternalId.set(row.externalId, row.id);
    byHash.set(hashKey(row.dedupeHash, row.occurrenceIndex), row.id);
    for (const m of row.matched) {
      if (m.externalId !== null) byExternalId.set(m.externalId, row.id);
      byHash.set(hashKey(m.dedupeHash, m.occurrenceIndex), row.id);
    }
  }

  const decisions: Array<Decision | undefined> = incoming.map((row) => {
    const targetId =
      (row.externalId !== null ? byExternalId.get(row.externalId) : undefined) ??
      byHash.get(hashKey(row.dedupeHash, row.occurrenceIndex));
    if (targetId === undefined) return undefined;
    const target = byId.get(targetId);
    return { kind: "duplicate", targetId, link: target !== undefined && isCandidate(side, target) };
  });

  // A row an exact duplicate points at is already accounted for: it cannot also absorb another purchase.
  const consumed = new Set<string>();
  for (const d of decisions) if (d?.kind === "duplicate") consumed.add(d.targetId);

  const candidates = existing.filter((row) => isCandidate(side, row));
  const order = incoming
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => decisions[index] === undefined)
    .sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.index - b.index));

  for (const { row, index } of order) {
    const near = candidates.filter(
      (c) =>
        !consumed.has(c.id) &&
        c.amountCents === row.amountCents &&
        Math.abs(daysBetween(c.date, row.date)) <= MATCH_WINDOW_DAYS,
    );
    if (near.length === 0) {
      const waiting = existing.filter(
        (r) =>
          r.awaitingBank &&
          !consumed.has(r.id) &&
          r.amountCents === row.amountCents &&
          Math.abs(daysBetween(r.date, row.date)) <= MATCH_WINDOW_DAYS,
      );
      const sameDayWaiting = waiting.filter((r) => r.date === row.date);
      const adopted = waiting.length === 1 ? waiting[0] : sameDayWaiting.length === 1 ? sameDayWaiting[0] : null;
      if (adopted) {
        consumed.add(adopted.id);
        decisions[index] = { kind: "adopt", targetId: adopted.id };
      } else {
        decisions[index] = { kind: "insert" };
      }
      continue;
    }
    const sameDay = near.filter((c) => c.date === row.date);
    const chosen = near.length === 1 ? near[0] : sameDay.length === 1 ? sameDay[0] : null;
    if (chosen) {
      consumed.add(chosen.id);
      decisions[index] = { kind: "merge", targetId: chosen.id };
    } else {
      decisions[index] = { kind: "possible", candidateIds: near.map((c) => c.id) };
    }
  }

  return decisions as Decision[];
}
