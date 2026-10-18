import { z } from "zod";

import { GOAL_NAME_MAX_LENGTH } from "./input";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_CENTS = 1_000_000_000;

/**
 * What Undo sends back after a goal is deleted: the goal row, its entries and the rules that pointed at it. It comes from the client, so the server validates it like any other input.
 */
export const goalSnapshotSchema = z.object({
  goal: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(GOAL_NAME_MAX_LENGTH),
    targetCents: z.number().int().min(1).max(MAX_CENTS),
    targetDate: date.nullable(),
    icon: z.string().max(32).nullable(),
    accountId: z.uuid().nullable(),
    startCents: z.number().int().min(0).max(MAX_CENTS),
    startDate: date,
    createdAt: z.iso.datetime(),
  }),
  contributions: z
    .array(
      z.object({
        id: z.uuid(),
        date,
        amountCents: z
          .number()
          .int()
          .refine((n) => n !== 0 && Math.abs(n) <= MAX_CENTS),
        transactionId: z.uuid().nullable(),
        createdAt: z.iso.datetime(),
      }),
    )
    .max(5000),
  // Savings rules that pointed at the goal; Undo re-links them.
  ruleIds: z.array(z.uuid()).max(500),
});

export type GoalSnapshot = z.infer<typeof goalSnapshotSchema>;
