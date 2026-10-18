import { z } from "zod";

import type { BankDecision, BankDecisions, BankPlan, BankPlanItem } from "./bank";

/** Far above the ~50 categories of a real export; bounds the JSON the server parses. */
export const MAX_BANK_DECISIONS = 500;

const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("map"), categoryId: z.uuid() }),
  z.object({ action: z.literal("ignore") }),
]);

export const bankDecisionsSchema = z
  .record(z.string().max(1000), decisionSchema)
  .refine((r) => Object.keys(r).length <= MAX_BANK_DECISIONS);

/** Parses the `bankDecisions` form field; null when it is not valid JSON of the expected shape. */
export function parseBankDecisions(raw: unknown): BankDecisions | null {
  if (raw === null || raw === undefined || raw === "") return {};
  if (typeof raw !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = bankDecisionsSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function planItems(plan: BankPlan): BankPlanItem[] {
  return plan.groups.flatMap((g) => (g.category ? [g.category, ...g.subcategories] : g.subcategories));
}

/**
 * The user's choices over the plan's suggestions: a key present in `overrides`
 * wins (null = explicitly undecided), else a suggested category is pre-mapped.
 */
export function effectiveDecisions(
  plan: BankPlan,
  overrides: Readonly<Record<string, BankDecision | null>>,
): BankDecisions {
  const out: Record<string, BankDecision> = {};
  for (const item of planItems(plan)) {
    const chosen = Object.hasOwn(overrides, item.key)
      ? overrides[item.key]
      : item.suggestedCategoryId
        ? ({ action: "map", categoryId: item.suggestedCategoryId } as const)
        : null;
    if (chosen) out[item.key] = chosen;
  }
  return out;
}

/**
 * Overrides that preselect "create" for every item the plan has no suggestion for,
 * so the preview opens with nothing undecided. Suggestions (same-name categories) are kept.
 */
export function withCreateDefaults(plan: BankPlan): Record<string, BankDecision> {
  const out: Record<string, BankDecision> = {};
  for (const item of planItems(plan)) {
    if (!item.suggestedCategoryId) out[item.key] = { action: "create" };
  }
  return out;
}

export interface DecisionSummary {
  create: number;
  map: number;
  ignore: number;
  undecided: number;
}

export function summarizeDecisions(plan: BankPlan, decisions: BankDecisions): DecisionSummary {
  const summary: DecisionSummary = { create: 0, map: 0, ignore: 0, undecided: 0 };
  for (const item of planItems(plan)) {
    const d = decisions[item.key];
    if (!d) summary.undecided += 1;
    else summary[d.action] += 1;
  }
  return summary;
}

/** `<select>` value <-> decision. */
export function decisionToSelectValue(d: BankDecision | undefined): string {
  if (!d) return "";
  return d.action === "map" ? `map:${d.categoryId}` : d.action;
}

export function selectValueToDecision(value: string): BankDecision | null {
  if (value === "create") return { action: "create" };
  if (value === "ignore") return { action: "ignore" };
  if (value.startsWith("map:")) return { action: "map", categoryId: value.slice(4) };
  return null;
}
