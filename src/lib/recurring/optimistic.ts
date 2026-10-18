export type RecurringStatus = "detected" | "confirmed" | "dismissed" | "ended";

export interface StatusChange {
  id: string;
  /** `stillActive` keeps the status and only clears the "Cancelled?" flag. */
  status: RecurringStatus | "stillActive";
}

type Item = { id: string; status: RecurringStatus; possiblyCancelled?: boolean };

/**
 * Optimistic view of the recurring list: every status change happens in place (the list
 * holds dismissed rows too, so a dismiss, a restore and an undo are all just a new
 * status), and "Still active" clears the "Cancelled?" flag. Server data replaces this as
 * soon as the action settles.
 */
export function applyStatusChange<T extends Item>(items: T[], change: StatusChange): T[] {
  return applyStatusChanges(items, [change]);
}

/** Several changes at once (Confirm all and its Undo). Later changes win for the same id. */
export function applyStatusChanges<T extends Item>(items: T[], changes: StatusChange[]): T[] {
  const byId = new Map(changes.map((c) => [c.id, c.status]));
  return items.map((i) => {
    const status = byId.get(i.id);
    if (status === undefined) return i;
    if (status === "stillActive") return { ...i, possiblyCancelled: false };
    // Ending or resuming also settles the flag (the server stores the answer on resume).
    return "possiblyCancelled" in i ? { ...i, status, possiblyCancelled: false } : { ...i, status };
  });
}

/**
 * Resolving the open price alert clears the item's "Price up" caption; accepting the new
 * price also makes it the item's usual amount (what the server does), keeping it leaves it.
 */
export function resolvePriceAlert<
  T extends { id: string; hasPriceAlert: boolean; typicalAmountCents: number; alert: { newAmountCents: number } | null },
>(items: T[], id: string, accept: boolean): T[] {
  return items.map((i) =>
    i.id === id
      ? {
          ...i,
          hasPriceAlert: false,
          typicalAmountCents: accept && i.alert ? i.alert.newAmountCents : i.typicalAmountCents,
          alert: null,
        }
      : i,
  );
}
