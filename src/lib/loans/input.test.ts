import { describe, expect, it } from "vitest";

import { loanFormSchema, parseRateThousandths } from "./input";

const valid = {
  name: " Crédit auto ",
  borrowed: "15 000",
  owed: "7 957,91",
  owedOn: "2026-09-25",
  rate: "4,90",
  insuranceMode: "amount",
  insurance: "6,62",
  lastPaymentOn: "2029-03-25",
  currentPaymentUntil: "",
  startedOn: "",
  amortizationFrom: "",
  recurringId: "",
};
const schema = loanFormSchema("2026-10-15");

describe("parseRateThousandths", () => {
  it("reads up to three decimals", () => {
    expect(parseRateThousandths("4,90", 30)).toBe(4900);
    expect(parseRateThousandths("1.5 %", 30)).toBe(1500);
    expect(parseRateThousandths("0,37", 5)).toBe(370);
    expect(parseRateThousandths("1,2345", 30)).toBeNull();
    expect(parseRateThousandths("31", 30)).toBeNull();
    expect(parseRateThousandths("abc", 30)).toBeNull();
  });
});

describe("loanFormSchema", () => {
  it("lets the last payment fall on the capital owed date, or before it, once there is a subscription date", () => {
    expect(schema.parse({ ...valid, owed: "0", startedOn: "2021-03-05", lastPaymentOn: "2026-09-25" })).toMatchObject({ startedOn: "2021-03-05" });
    expect(schema.parse({ ...valid, owed: "0", startedOn: "2021-03-05", amortizationFrom: "2023-03-05", lastPaymentOn: "2026-01-05" })).toMatchObject({ amortizationFrom: "2023-03-05" });
  });
  it("parses a valid form into cents and thousandths", () => {
    expect(schema.parse(valid)).toMatchObject({
      name: "Crédit auto",
      borrowed: 1_500_000,
      owed: 795_791,
      rate: 4900,
      insuranceCents: 662,
      insuranceRateThousandths: null,
      currentPaymentUntil: null,
      startedOn: null,
      amortizationFrom: null,
      recurringId: null,
    });
  });
  it("reads an insurance rate", () => {
    expect(schema.parse({ ...valid, insuranceMode: "rate", insurance: "0,37" })).toMatchObject({ insuranceCents: null, insuranceRateThousandths: 370 });
  });
  it.each([
    [{ name: " " }, "nameRequired"],
    [{ name: "x".repeat(51) }, "nameTooLong"],
    [{ borrowed: "0" }, "amountInvalid"],
    [{ owed: "-5" }, "amountInvalid"],
    [{ rate: "40" }, "rateInvalid"],
    [{ owedOn: "2026-02-30" }, "dateInvalid"],
    [{ owedOn: "2026-10-16" }, "dateTooLate"],
    [{ lastPaymentOn: "2026-09-25" }, "lastPaymentTooEarly"],
    [{ currentPaymentUntil: "2029-03-25" }, "currentPaymentOutOfRange"],
    [{ insuranceMode: "rate", insurance: "6" }, "rateInvalid"],
    [{ startedOn: "2026-09-26" }, "startedAfterAnchor"],
    [{ startedOn: "2026-09-25", lastPaymentOn: "2026-09-25" }, "lastPaymentTooEarlyStart"],
    [{ startedOn: "2021-03-05", lastPaymentOn: "2026-09-25" }, "lastPaymentStillOwed"],
    [{ amortizationFrom: "2022-01-05" }, "amortizationNeedsStart"],
    [{ startedOn: "2021-03-05", amortizationFrom: "2021-03-05" }, "amortizationOutOfRange"],
    [{ startedOn: "2021-03-05", amortizationFrom: "2030-01-05" }, "amortizationOutOfRange"],
  ])("rejects %j", (patch, message) => {
    const result = schema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(message);
  });
});
