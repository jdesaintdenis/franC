import { addDays } from "../recurring/dates";

/** One balance checkpoint: the balance was `amountCents` at the end of `date`. */
export type GapCheckpoint = {
  id: string;
  /** ISO day. */
  date: string;
  amountCents: number;
  source: "manual" | "bank";
  /** A difference the user accepted at this checkpoint (Accept the bank's balance). */
  acceptedGapCents: number;
};

export type BalanceGap = {
  /** The bank's change minus franC's movement: negative when the bank shows less than franC (spending missing in franC, or extra income in franC), positive when it shows more. */
  amountCents: number;
  /** First day the difference can come from (the day after the last checkpoint that agreed). */
  from: string;
  /** Day of the first checkpoint after which the difference stayed as it is now. */
  to: string;
  /** The latest bank checkpoint: where an accepted gap is recorded. */
  checkpointId: string;
};

/**
 * Whether franC's transactions add up to what the bank says. The series starts at the manual
 * checkpoint when there is one (otherwise at the first bank checkpoint); each later checkpoint's
 * running difference is the bank's change since the start, minus franC's movement booked in
 * (start, checkpoint], minus the gaps accepted so far. Offsetting differences (a row booked a day
 * off) cancel out. `movementsByBookingDay` is the non-ignored movement per booking day.
 *
 * Null when the latest difference is 0 or there is no bank checkpoint to compare.
 */
export function findBalanceGap(
  checkpoints: readonly GapCheckpoint[],
  movementsByBookingDay: ReadonlyMap<string, number>,
): BalanceGap | null {
  const manual = checkpoints.find((c) => c.source === "manual") ?? null;
  const bank = checkpoints
    // A bank balance at or before the starting balance's day says nothing about what comes after it.
    .filter((c) => c.source === "bank" && (manual === null || c.date > manual.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (bank.length === 0) return null;
  const series = manual ? [manual, ...bank] : bank;
  const baseline = series[0];

  const days = [...movementsByBookingDay.keys()].filter((d) => d > baseline.date).sort();
  const differences: number[] = [0];
  let accepted = 0;
  let dayIndex = 0;
  let movement = 0;
  for (let k = 1; k < series.length; k++) {
    const checkpoint = series[k];
    while (dayIndex < days.length && days[dayIndex] <= checkpoint.date) {
      movement += movementsByBookingDay.get(days[dayIndex]) ?? 0;
      dayIndex++;
    }
    accepted += checkpoint.acceptedGapCents;
    differences.push(checkpoint.amountCents - baseline.amountCents - movement - accepted);
  }

  const latest = differences.length - 1;
  const current = differences[latest];
  if (current === 0) return null;

  let lastAgreed = 0;
  for (let k = latest; k >= 0; k--) {
    if (differences[k] === 0) {
      lastAgreed = k;
      break;
    }
  }
  let firstStable = latest;
  while (firstStable - 1 > lastAgreed && differences[firstStable - 1] === current) firstStable--;

  return {
    amountCents: current,
    from: addDays(series[lastAgreed].date, 1),
    to: series[firstStable].date,
    checkpointId: series[latest].id,
  };
}
