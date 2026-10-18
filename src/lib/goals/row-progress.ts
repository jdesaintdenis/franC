import type { GoalRow } from "@/db/queries/goals";

import { goalProgress, type GoalProgress } from "./progress";

/** Progress of a listed goal: what it holds against its target. */
export function progressOfRow(row: GoalRow, today: string): GoalProgress {
  return goalProgress({
    targetCents: row.targetCents,
    targetDate: row.targetDate,
    savedCents: row.savedCents,
    startCents: row.startCents,
    startDate: row.startDate,
    today,
  });
}
