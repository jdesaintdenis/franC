import type { Sign } from "./detect";

export interface RekeyItem {
  id: string;
  accountId: string;
  merchantKey: string;
  /** From the sign of the item's usual amount (`recurring` stores none). */
  sign: Sign;
  status: "detected" | "confirmed" | "dismissed" | "ended";
  lastSeenDate: string;
}

export interface RekeyInput {
  items: readonly RekeyItem[];
  /** Item id -> ids of the transactions currently linked to it (`transactions.recurring_id`). */
  linkedTxIds: ReadonlyMap<string, readonly string[]>;
  /** Transaction id -> the key its group has now (`txMerchantKey`); rows out of play are absent. */
  currentKeyOfTx: ReadonlyMap<string, string>;
  /** Whether transactions of this account, key and sign form a group right now. */
  hasGroup: (accountId: string, key: string, sign: Sign) => boolean;
}

export interface RekeyResult {
  /** Surviving items whose key changes. */
  rekeys: { id: string; merchantKey: string }[];
  /** Items to delete: losers of a merge (their price alerts cascade). */
  deletes: string[];
}

function byPreference(a: RekeyItem, b: RekeyItem): number {
  // An ended item is still the user's decision about that merchant, so it beats a fresh detection.
  const statusRank = (i: RekeyItem) => (i.status === "confirmed" ? 0 : i.status === "ended" ? 1 : 2);
  return (
    statusRank(a) - statusRank(b) ||
    (a.lastSeenDate === b.lastSeenDate ? 0 : a.lastSeenDate > b.lastSeenDate ? -1 : 1) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Makes recurring items follow their transactions when merchant names are added,
 * removed or merged. An item whose own key no longer has a group moves to the key
 * most of its linked transactions now belong to (ties: the smaller key). When several
 * items end up on one key of an account, the confirmed one survives, then an ended one, then the one with
 * the latest charge, then the smaller id; the others are deleted. Dismissed items are
 * final: never moved, and a move onto a dismissed item's key is skipped.
 */
export function rekeyItems(input: RekeyInput): RekeyResult {
  const { items, linkedTxIds, currentKeyOfTx, hasGroup } = input;
  const slot = (accountId: string, key: string) => `${accountId}\u0000${key}`;

  const dismissedSlots = new Set(
    items.filter((i) => i.status === "dismissed").map((i) => slot(i.accountId, i.merchantKey)),
  );
  // Everyone who ends up on a slot: stayers first, then movers.
  const contenders = new Map<string, RekeyItem[]>();
  const add = (key: string, item: RekeyItem) => {
    const list = contenders.get(key);
    if (list) list.push(item);
    else contenders.set(key, [item]);
  };

  const movers = new Map<string, string>(); // item id -> target key
  for (const item of items) {
    if (item.status === "dismissed") continue;
    if (hasGroup(item.accountId, item.merchantKey, item.sign)) {
      add(slot(item.accountId, item.merchantKey), item);
      continue;
    }
    const votes = new Map<string, number>();
    for (const txId of linkedTxIds.get(item.id) ?? []) {
      const key = currentKeyOfTx.get(txId);
      if (key === undefined || !hasGroup(item.accountId, key, item.sign)) continue;
      votes.set(key, (votes.get(key) ?? 0) + 1);
    }
    let target: string | null = null;
    let best = 0;
    for (const [key, n] of votes) {
      if (n > best || (n === best && target !== null && key < target)) {
        target = key;
        best = n;
      }
    }
    if (target === null || dismissedSlots.has(slot(item.accountId, target))) {
      add(slot(item.accountId, item.merchantKey), item);
      continue;
    }
    movers.set(item.id, target);
    add(slot(item.accountId, target), item);
  }

  const result: RekeyResult = { rekeys: [], deletes: [] };
  for (const list of contenders.values()) {
    const [survivor, ...losers] = [...list].sort(byPreference);
    for (const loser of losers) {
      // A loser that never moved is a genuine second item on that key: only movers merge.
      if (movers.has(loser.id) || movers.has(survivor.id)) result.deletes.push(loser.id);
    }
    const target = movers.get(survivor.id);
    if (target !== undefined) result.rekeys.push({ id: survivor.id, merchantKey: target });
  }
  return result;
}
