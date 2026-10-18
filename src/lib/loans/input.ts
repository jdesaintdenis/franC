import { z } from "zod";

import { isValidIsoDate, parseBalanceAmount } from "../balance/input";

export const LOAN_NAME_MAX_LENGTH = 50;

export type LoanFormError =
  | "nameRequired"
  | "nameTooLong"
  | "amountInvalid"
  | "rateInvalid"
  | "dateInvalid"
  | "dateTooLate"
  | "lastPaymentTooEarly"
  | "lastPaymentTooEarlyStart"
  | "lastPaymentStillOwed"
  | "startedAfterAnchor"
  | "amortizationNeedsStart"
  | "amortizationOutOfRange"
  | "currentPaymentOutOfRange";

/** "4,90" / "4.9" → 4900 (thousandths of a percent, up to three decimals); null when not a rate. */
export function parseRateThousandths(input: string, maxPercent: number): number | null {
  const compact = input.replace(/[\s  %]+/g, "").replace(".", ",");
  if (!/^\d+(?:,\d{1,3})?$/.test(compact)) return null;
  const [whole, decimals = ""] = compact.split(",");
  const value = Number(whole) * 1000 + Number(decimals.padEnd(3, "0"));
  return value <= maxPercent * 1000 ? value : null;
}

const amount = (min: number) =>
  z.string().transform((value, ctx) => {
    const parsed = parseBalanceAmount(value);
    if (!parsed.ok || parsed.cents === null || parsed.cents < min) {
      ctx.addIssue({ code: "custom", message: "amountInvalid" });
      return z.NEVER;
    }
    return parsed.cents;
  });

const isoDate = z.string().refine(isValidIsoDate, "dateInvalid");
const optionalDate = z.string().transform((v) => (v === "" ? null : v)).pipe(isoDate.nullable());

/**
 * The loan form, already Zod-parsed from FormData strings. `tomorrow` is Europe/Paris tomorrow (the capital can
 * be given as of tomorrow, like a starting balance).
 */
export function loanFormSchema(tomorrow: string) {
  return z
    .object({
      name: z.string().trim().min(1, "nameRequired").max(LOAN_NAME_MAX_LENGTH, "nameTooLong"),
      borrowed: amount(1),
      owed: amount(0),
      owedOn: isoDate,
      rate: z.string().transform((v, ctx) => {
        const parsed = parseRateThousandths(v, 30);
        if (parsed === null) ctx.addIssue({ code: "custom", message: "rateInvalid" });
        return parsed ?? z.NEVER;
      }),
      insuranceMode: z.enum(["amount", "rate"]),
      insurance: z.string().transform((v) => (v.trim() === "" ? "0" : v)),
      lastPaymentOn: isoDate,
      currentPaymentUntil: optionalDate,
      startedOn: optionalDate,
      amortizationFrom: optionalDate,
      recurringId: z.string().transform((v) => (v === "" ? null : v)).pipe(z.uuid().nullable()),
    })
    .transform((form, ctx) => {
      let insuranceCents: number | null = null;
      let insuranceRateThousandths: number | null = null;
      if (form.insuranceMode === "amount") {
        const parsed = parseBalanceAmount(form.insurance);
        if (!parsed.ok || parsed.cents === null || parsed.cents < 0 || parsed.cents > 10_000_000) {
          ctx.addIssue({ code: "custom", message: "amountInvalid" });
          return z.NEVER;
        }
        insuranceCents = parsed.cents;
      } else {
        insuranceRateThousandths = parseRateThousandths(form.insurance, 5);
        if (insuranceRateThousandths === null) {
          ctx.addIssue({ code: "custom", message: "rateInvalid" });
          return z.NEVER;
        }
      }
      if (form.owedOn > tomorrow) {
        ctx.addIssue({ code: "custom", message: "dateTooLate" });
        return z.NEVER;
      }
      if (form.startedOn !== null && form.startedOn > form.owedOn) {
        ctx.addIssue({ code: "custom", message: "startedAfterAnchor" });
        return z.NEVER;
      }
      // With a subscription date the loan may already be over: the last payment only has to follow it.
      const from = form.startedOn ?? form.owedOn;
      if (form.lastPaymentOn <= from) {
        ctx.addIssue({ code: "custom", message: form.startedOn === null ? "lastPaymentTooEarly" : "lastPaymentTooEarlyStart" });
        return z.NEVER;
      }
      // A loan already over is fine, but capital still owed on "as of" means the contract runs past it.
      if (form.owed > 0 && form.lastPaymentOn <= form.owedOn) {
        ctx.addIssue({ code: "custom", message: "lastPaymentStillOwed" });
        return z.NEVER;
      }
      if (form.amortizationFrom !== null) {
        if (form.startedOn === null) {
          ctx.addIssue({ code: "custom", message: "amortizationNeedsStart" });
          return z.NEVER;
        }
        if (form.amortizationFrom <= form.startedOn || form.amortizationFrom > form.lastPaymentOn) {
          ctx.addIssue({ code: "custom", message: "amortizationOutOfRange" });
          return z.NEVER;
        }
      }
      if (form.currentPaymentUntil !== null && (form.currentPaymentUntil < from || form.currentPaymentUntil >= form.lastPaymentOn)) {
        ctx.addIssue({ code: "custom", message: "currentPaymentOutOfRange" });
        return z.NEVER;
      }
      return { ...form, insuranceCents, insuranceRateThousandths };
    });
}

export type LoanFormValues = z.output<ReturnType<typeof loanFormSchema>>;

/** The corrections: "capital owed at the start of this day". */
export function loanCorrectionSchema(tomorrow: string) {
  return z.object({
    owed: amount(0),
    owedOn: isoDate.refine((d) => d <= tomorrow, "dateTooLate"),
  });
}

/** Interest and insurance typed for one payment. */
export const loanSplitSchema = z.object({ interest: amount(0), insurance: amount(0) });

