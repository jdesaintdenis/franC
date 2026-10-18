import { describe, expect, it } from "vitest";

import { loanLength, paymentSlots } from "./months";

describe("paymentSlots", () => {
  it("falls on the payment day, clamped in short months", () => {
    expect(paymentSlots("2025-05-31", "2025-01-31")).toEqual(["2025-02-28", "2025-03-31", "2025-04-30", "2025-05-31"]);
  });
  it("is empty when the last payment is not after the start", () => {
    expect(paymentSlots("2025-05-05", "2025-05-05")).toEqual([]);
  });
});

describe("loanLength", () => {
  it("counts total, paid and left", () => {
    expect(loanLength({ lastPaymentOn: "2025-05-05", after: "2025-01-05", today: "2025-03-10" })).toEqual({ monthsTotal: 4, monthsPaid: 2, monthsLeft: 2 });
  });
});
