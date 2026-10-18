// Loan arithmetic in integer cents. Rates are yearly, in thousandths of a percent (1,500 % → 1500).

/** What a month's interest is, the way the bank's amortization table computes it: owed × yearly rate ÷ 12, half up. */
export function monthlyInterest(owedCents: number, rateThousandths: number): number {
  return Math.round((owedCents * rateThousandths) / 1_200_000);
}

export interface InsuranceTerms {
  /** A fixed amount per month… */
  insuranceCents: number | null;
  /** …or a yearly rate on the capital owed. Exactly one of the two is set. */
  insuranceRateThousandths: number | null;
}

export function monthlyInsurance(owedCents: number, terms: InsuranceTerms): number {
  if (terms.insuranceCents !== null) return terms.insuranceCents;
  return monthlyInterest(owedCents, terms.insuranceRateThousandths ?? 0);
}

/**
 * Constant monthly payment that repays `owedCents` in `months` at a yearly rate (thousandths of a percent).
 * An insurance charged as a rate on the capital owed is part of that rate: the bank's total stays constant.
 */
export function annuityCents(owedCents: number, rateThousandths: number, months: number): number {
  if (months <= 0 || owedCents <= 0) return 0;
  const r = rateThousandths / 1_200_000;
  if (r === 0) return Math.round(owedCents / months);
  return Math.round((owedCents * r) / (1 - (1 + r) ** -months));
}
