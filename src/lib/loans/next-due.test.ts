import { describe, expect, it } from "vitest";

import { nextDueDate } from "./next-due";
import { repaidPercent } from "./progress";

describe("nextDueDate", () => {
  const base = { startDate: "2026-01-01", today: "2026-10-14" };
  it("uses the regular payment's expected date when it is ahead", () => {
    expect(nextDueDate({ ...base, recurringNext: "2026-10-25", lastPaymentDate: "2026-09-25" })).toBe("2026-10-25");
  });
  it("falls back to a month after the last payment", () => {
    expect(nextDueDate({ ...base, recurringNext: "2026-10-01", lastPaymentDate: "2026-09-30" })).toBe("2026-10-30");
    expect(nextDueDate({ ...base, recurringNext: null, lastPaymentDate: "2026-01-31" })).toBe("2026-02-28");
  });
  it("falls back to the loan's start with no payment yet", () => {
    expect(nextDueDate({ ...base, recurringNext: null, lastPaymentDate: null })).toBe("2026-01-01");
  });
});

describe("repaidPercent", () => {
  it("floors and clamps", () => {
    expect(repaidPercent(1000, 530)).toBe(47);
    expect(repaidPercent(1000, 1200)).toBe(0);
    expect(repaidPercent(1000, 0)).toBe(100);
  });
});
