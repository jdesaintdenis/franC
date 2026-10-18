import { savingsRatePercent } from "./savings-rate";

export type YearHeadlineKind = "saved" | "overspent" | "even" | "noIncome";

export interface YearHeadline {
  kind: YearHeadlineKind;
  /** Always >= 0: the size of the gap; the kind says which way it goes. */
  amountCents: number;
  /** Whole percent of income saved; null unless kind is "saved" or "overspent" with income. */
  ratePercent: number | null;
}

/**
 * The year in one sentence's worth of data. "even" means the gap rounds to 0 in whole euros
 * (the unit the page displays), so the headline never says "saved €0" or "more than you earned €0".
 */
export function yearHeadline(incomeCents: number, spentCents: number): YearHeadline {
  const ratePercent = savingsRatePercent(incomeCents, spentCents);
  if (incomeCents <= 0) return { kind: "noIncome", amountCents: spentCents, ratePercent };
  const net = incomeCents - spentCents;
  if (Math.round(Math.abs(net) / 100) === 0) return { kind: "even", amountCents: 0, ratePercent };
  if (net > 0) return { kind: "saved", amountCents: net, ratePercent };
  return { kind: "overspent", amountCents: -net, ratePercent };
}
