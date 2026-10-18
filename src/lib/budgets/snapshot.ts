import { z } from "zod";

import { MAX_BUDGET_CENTS } from "./amount";

/** What a budget row holds, so removing a budget can be undone exactly (the carry survives). */
export interface BudgetSnapshot {
  categoryId: string;
  amountCents: number;
  rollover: boolean;
  /** First day of the month the carry counts from ("YYYY-MM-01"); null while rollover is off. */
  rolloverStart: string | null;
  rolloverBaseCents: number;
}

/** Carry built before the start: bounded to a century of maximum budgets, far inside a safe integer. */
export const MAX_ROLLOVER_BASE_CENTS = MAX_BUDGET_CENTS * 1200;

const FIRST_OF_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

/**
 * Undo data comes back from the client, so it is checked like any input: the same limits as
 * a saved budget, a rollover start that is the 1st of a month, and a start that agrees with
 * the rollover flag (the table's own check, plus a zero base while rollover is off).
 */
export const budgetSnapshotSchema = z
  .object({
    categoryId: z.uuid(),
    amountCents: z.number().int().min(1).max(MAX_BUDGET_CENTS),
    rollover: z.boolean(),
    rolloverStart: z.string().regex(FIRST_OF_MONTH_RE).nullable(),
    rolloverBaseCents: z.number().int().min(-MAX_ROLLOVER_BASE_CENTS).max(MAX_ROLLOVER_BASE_CENTS),
  })
  .superRefine((value, ctx) => {
    if (value.rollover && value.rolloverStart === null) {
      ctx.addIssue({ code: "custom", path: ["rolloverStart"], message: "rollover needs a start" });
    }
    if (!value.rollover && (value.rolloverStart !== null || value.rolloverBaseCents !== 0)) {
      ctx.addIssue({ code: "custom", path: ["rollover"], message: "no rollover, no start or base" });
    }
  });
