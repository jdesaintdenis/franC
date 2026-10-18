import type { GoalProgress } from "./progress";

export interface GoalsSummary {
  savedCents: number;
  targetCents: number;
  /** 0-100, floored. */
  percent: number;
  /** Per month to meet every running dated goal's date. */
  monthlyCents: number;
}

/** The card above the goals list: everything set aside against everything aimed at. */
export function goalsSummary(goals: readonly { targetCents: number; progress: GoalProgress }[]): GoalsSummary {
  let savedCents = 0;
  let targetCents = 0;
  let monthlyCents = 0;
  for (const { targetCents: target, progress } of goals) {
    savedCents += progress.savedCents;
    targetCents += target;
    if (progress.status === "onTrack" || progress.status === "behind") monthlyCents += progress.monthlyCents ?? 0;
  }
  const percent = targetCents > 0 ? Math.min(100, Math.floor((savedCents * 100) / targetCents)) : 0;
  return { savedCents, targetCents, percent, monthlyCents };
}
