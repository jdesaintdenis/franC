export interface ContributionPreset {
  kind: "monthly" | "remaining" | "all";
  cents: number;
}

/**
 * Quick amounts above a goal's amount field (SPEC §75 K): what keeps it on time, what finishes it, and,
 * when assigning from an account, everything the account has left. Taking money out has none.
 */
export function contributionPresets(input: {
  mode: "manual" | "assign";
  direction: "add" | "remove";
  /** Per month to meet the date; null for a goal without a date or one that is not running. */
  monthlyCents: number | null;
  remainingCents: number;
  notAssignedCents: number | null;
}): ContributionPreset[] {
  if (input.direction === "remove") return [];
  const all: ContributionPreset[] = [];
  if (input.monthlyCents !== null && input.monthlyCents > 0) all.push({ kind: "monthly", cents: input.monthlyCents });
  if (input.remainingCents > 0) all.push({ kind: "remaining", cents: input.remainingCents });
  if (input.mode === "assign" && input.notAssignedCents !== null && input.notAssignedCents > 0) {
    all.push({ kind: "all", cents: input.notAssignedCents });
  }
  // A preset that repeats an earlier amount adds nothing to tap.
  return all.filter((p, i) => all.findIndex((q) => q.cents === p.cents) === i);
}
