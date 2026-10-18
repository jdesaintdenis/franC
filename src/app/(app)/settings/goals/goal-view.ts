import type { GoalProgress } from "@/lib/goals/progress";

import type { ContributionEntry } from "./contribution-form";
import type { EditableGoal, GoalAccountOption } from "./goal-form";

/** What the goals screen needs of one goal (plain data, passed from the server page). */
export interface GoalView {
  goal: EditableGoal;
  accountName: string | null;
  progress: GoalProgress;
  /** The account choices for this goal's edit form. */
  accounts: GoalAccountOption[];
  /** Not assigned in this goal's account; null for a manual goal or an account without a balance. */
  notAssignedCents: number | null;
  /** Latest entries, newest first. */
  entries: ContributionEntry[];
}

/** One account that has goals, with what is left to assign (null = no starting balance yet). */
export interface AccountMoneyView {
  accountId: string;
  accountName: string;
  /** Null = no starting balance yet. */
  balanceCents: number | null;
  assignedCents: number;
  notAssignedCents: number | null;
}
