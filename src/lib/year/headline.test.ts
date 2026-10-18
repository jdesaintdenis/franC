import { describe, expect, it } from "vitest";

import { yearHeadline } from "./headline";

describe("yearHeadline", () => {
  it("saved: the difference and the rate", () => {
    expect(yearHeadline(100000, 75000)).toEqual({ kind: "saved", amountCents: 25000, ratePercent: 25 });
  });

  it("overspent: a positive gap and a negative rate", () => {
    expect(yearHeadline(100000, 108000)).toEqual({ kind: "overspent", amountCents: 8000, ratePercent: -8 });
  });

  it("even when the gap rounds to zero euros, in either direction", () => {
    expect(yearHeadline(100000, 100049).kind).toBe("even");
    expect(yearHeadline(100049, 100000).kind).toBe("even");
    expect(yearHeadline(100000, 100000)).toEqual({ kind: "even", amountCents: 0, ratePercent: 0 });
  });

  it("50 cents rounds up to a euro, so it is not even", () => {
    expect(yearHeadline(100050, 100000).kind).toBe("saved");
  });

  it("noIncome when income is zero or negative, with spending as the amount", () => {
    expect(yearHeadline(0, 4200)).toEqual({ kind: "noIncome", amountCents: 4200, ratePercent: null });
    expect(yearHeadline(-100, 4200).kind).toBe("noIncome");
    expect(yearHeadline(0, 0).kind).toBe("noIncome");
  });
});
