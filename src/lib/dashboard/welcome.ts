export type WelcomeStepKey = "bank" | "import" | "balance" | "review" | "budget";

export interface WelcomeInput {
  hasTransactions: boolean;
  /** Transactions waiting in the review queue. */
  toReview: number;
  /** Any account has a starting balance. */
  hasBalance: boolean;
  /** At least one category budget. */
  hasBudget: boolean;
  /** The user may use bank sync: step 1 is then "connect your bank" instead of "import". */
  bankSync: boolean;
  /** A bank connection feeds at least one franC account. */
  hasBankLink: boolean;
}

export interface WelcomeStep {
  key: WelcomeStepKey;
  done: boolean;
}

export interface WelcomeSteps {
  steps: WelcomeStep[];
  /** The first step not done yet, to highlight; null once all are done. */
  nextKey: WelcomeStepKey | null;
  doneCount: number;
  allDone: boolean;
}

/** The first-run checklist, every tick derived from existing data. Codes only; the UI words them. */
export function buildWelcomeSteps(input: WelcomeInput): WelcomeSteps {
  const steps: WelcomeStep[] = [
    input.bankSync
      ? { key: "bank", done: input.hasBankLink || input.hasTransactions }
      : { key: "import", done: input.hasTransactions },
    // Before review: a connected bank gives the balance by itself, so this ticks right after connecting.
    { key: "balance", done: input.hasBalance },
    // Nothing to review before any import, so this one cannot tick early.
    { key: "review", done: input.hasTransactions && input.toReview === 0 },
    { key: "budget", done: input.hasBudget },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    nextKey: steps.find((s) => !s.done)?.key ?? null,
    doneCount,
    allDone: doneCount === steps.length,
  };
}
