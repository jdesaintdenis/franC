import { isInactive, type ForecastItem } from "../recurring/forecast";
import { coveringBudgetId } from "../safe-to-spend/compute";
import type { BudgetEntry } from "./progress";

/** A regular payment's charge inside a budget: already paid this month, or still expected. */
export interface BudgetCharge {
  recurringId: string;
  name: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Positive. */
  amountCents: number;
  paid: boolean;
}

export interface ChargeTotals {
  paidCents: number;
  dueCents: number;
}

// A charge belongs to the entry of its own category or of its direct parent, like spending does.
function belongsTo(entryId: string, categoryId: string | null, parentOf: ReadonlyMap<string, string | null>): boolean {
  return coveringBudgetId(categoryId, parentOf, new Set([entryId])) !== null;
}

/** The charges of every budget entry (parents and subcategory budgets), by date then name. */
export function chargesByEntry(args: {
  categoryIds: readonly string[];
  paid: readonly { recurringId: string; date: string; amountCents: number; categoryId: string }[];
  /** Bills still due this month, outflows as stored (negative). */
  due: readonly { id: string; name: string; date: string; amountCents: number; categoryId: string | null }[];
  /** Recurring id -> name, for the paid lines. */
  names: ReadonlyMap<string, string>;
  parentOf: ReadonlyMap<string, string | null>;
}): Map<string, BudgetCharge[]> {
  const { categoryIds, paid, due, names, parentOf } = args;
  const all: (BudgetCharge & { categoryId: string | null })[] = [
    ...paid.map((p) => ({
      recurringId: p.recurringId,
      name: names.get(p.recurringId) ?? "",
      date: p.date,
      amountCents: p.amountCents,
      paid: true,
      categoryId: p.categoryId as string | null,
    })),
    ...due.map((d) => ({ recurringId: d.id, name: d.name, date: d.date, amountCents: -d.amountCents, paid: false, categoryId: d.categoryId })),
  ];
  const byEntry = new Map<string, BudgetCharge[]>();
  for (const id of categoryIds) {
    const mine = all
      .filter((c) => belongsTo(id, c.categoryId, parentOf))
      .map((c) => ({ recurringId: c.recurringId, name: c.name, date: c.date, amountCents: c.amountCents, paid: c.paid }))
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.name.localeCompare(b.name)));
    byEntry.set(id, mine);
  }
  return byEntry;
}

export function chargeTotals(charges: readonly Pick<BudgetCharge, "amountCents" | "paid">[]): ChargeTotals {
  let paidCents = 0;
  let dueCents = 0;
  for (const c of charges) {
    if (c.paid) paidCents += c.amountCents;
    else dueCents += c.amountCents;
  }
  return { paidCents, dueCents };
}

/** Share of a budget the regular payments must cover to count as payments-only (a 123,99 € bill fills a 124 € budget). */
export const CHARGES_ONLY_PERCENT = 95;

/** A budget the regular payments (nearly) fill: nothing of it is left to decide, so lists hide it. */
export function isChargesOnly(entry: Pick<BudgetEntry, "availableCents" | "status">, totals: ChargeTotals): boolean {
  return (
    entry.availableCents > 0 &&
    entry.status !== "over" &&
    (totals.paidCents + totals.dueCents) * 100 >= entry.availableCents * CHARGES_ONLY_PERCENT
  );
}

/** What is left once the budget's spending and the payments still due are set aside; negative = too much planned. */
export function leftToSpend(entry: Pick<BudgetEntry, "availableCents" | "spentCents">, totals: ChargeTotals): number {
  return entry.availableCents - entry.spentCents - totals.dueCents;
}

export interface ChargesPreset {
  cents: number;
  names: { name: string; day: number }[];
}

/**
 * The budget sheet's "Payments" pill: this month's outflow charges of the category (and its
 * subcategories) rounded up to the euro, with the names for the note.
 */
export function chargesPresetCents(
  entries: readonly { name: string; date: string; amountCents: number; categoryId?: string | null; status: ForecastItem["status"] }[],
  categoryId: string,
  parentOf: ReadonlyMap<string, string | null>,
): ChargesPreset {
  let total = 0;
  const names: { name: string; day: number }[] = [];
  for (const e of entries) {
    if (e.amountCents >= 0 || isInactive(e.status) || !belongsTo(categoryId, e.categoryId ?? null, parentOf)) continue;
    total += -e.amountCents;
    names.push({ name: e.name, day: Number(e.date.slice(8, 10)) });
  }
  return { cents: Math.floor((total + 99) / 100) * 100, names };
}
