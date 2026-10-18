/**
 * Savings goal progress (Slice 30, SPEC §44). Pure and in integer cents.
 *
 * - reached: saved ≥ target.
 * - noDate: no target date, so progress only.
 * - pastDue: the target date's month is over and the goal isn't reached.
 * - onTrack / behind: saved compared with a straight line from the plan's start
 *   (amount and month) to the target (amount and month), measured at the start of the
 *   current month, so this month's saving isn't due yet.
 */
export type GoalStatus = "reached" | "noDate" | "pastDue" | "onTrack" | "behind";

export interface GoalProgressInput {
  targetCents: number;
  /** "YYYY-MM-DD", or null for a goal without a date. */
  targetDate: string | null;
  /** Account balance or sum of contributions; may be negative. */
  savedCents: number;
  /** Saved amount when the plan (re)started. */
  startCents: number;
  /** "YYYY-MM-DD" the plan (re)started. */
  startDate: string;
  /** "YYYY-MM-DD", in the user's zone. */
  today: string;
}

export interface GoalProgress {
  status: GoalStatus;
  /** Never negative: an overdrawn account has saved nothing. */
  savedCents: number;
  remainingCents: number;
  /** 0–100, rounded down. */
  percent: number;
  /** Months left counting the current month and the target month; null without a date or once past/reached. */
  monthsLeft: number | null;
  /** What to put aside each month, rounded up to the cent; null when there is no plan. */
  monthlyCents: number | null;
  /** How far below the on-track line; 0 unless "behind". */
  behindCents: number;
}

/** Months since year 0, so two dates' months can be subtracted. */
function monthIndex(isoDate: string): number {
  return Number(isoDate.slice(0, 4)) * 12 + Number(isoDate.slice(5, 7)) - 1;
}

export function goalProgress(input: GoalProgressInput): GoalProgress {
  const { targetCents, targetDate, today } = input;
  const saved = Math.max(0, input.savedCents);
  const remaining = Math.max(0, targetCents - saved);
  const percent = Math.min(100, Math.floor((saved * 100) / targetCents));
  const base = { savedCents: saved, remainingCents: remaining, percent, behindCents: 0 };

  if (saved >= targetCents) return { ...base, status: "reached", monthsLeft: null, monthlyCents: null };
  if (targetDate === null) return { ...base, status: "noDate", monthsLeft: null, monthlyCents: null };

  const now = monthIndex(today);
  const end = monthIndex(targetDate);
  if (end < now) return { ...base, status: "pastDue", monthsLeft: null, monthlyCents: null };

  const monthsLeft = end - now + 1;
  const monthlyCents = Math.ceil(remaining / monthsLeft);

  const expected = expectedByNow(input, now, end);
  const behind = Math.max(0, expected - saved);
  return {
    ...base,
    status: behind > 0 ? "behind" : "onTrack",
    monthsLeft,
    monthlyCents,
    behindCents: behind,
  };
}

/**
 * Where the straight line from the start to the target stands at the start of the current
 * month. The plan spans the start month through the target month, both counted.
 */
function expectedByNow(input: GoalProgressInput, now: number, end: number): number {
  const start = monthIndex(input.startDate);
  const startCents = Math.max(0, input.startCents);
  const total = Math.max(1, end - start + 1);
  const elapsed = Math.min(total, Math.max(0, now - start));
  // BigInt keeps the cross product exact; floor favours the user by a cent at most.
  const step = (BigInt(input.targetCents - startCents) * BigInt(elapsed)) / BigInt(total);
  return startCents + Number(step);
}

const STATUS_ORDER: Record<GoalStatus, number> = { behind: 0, pastDue: 0, onTrack: 1, noDate: 1, reached: 2 };

/**
 * Dashboard order: goals needing attention (behind, past date) first, then by target date
 * with dateless goals after, reached goals last; ties by name.
 */
export function compareGoals(
  a: { name: string; targetDate: string | null; progress: GoalProgress },
  b: { name: string; targetDate: string | null; progress: GoalProgress },
): number {
  const byStatus = STATUS_ORDER[a.progress.status] - STATUS_ORDER[b.progress.status];
  if (byStatus !== 0) return byStatus;
  if (a.targetDate !== b.targetDate) {
    if (a.targetDate === null) return 1;
    if (b.targetDate === null) return -1;
    return a.targetDate < b.targetDate ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
