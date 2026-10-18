import { describe, expect, it } from "vitest";

import { parseContributionForm, parseGoalForm } from "./input";

const today = "2026-09-30";
const valid = { name: "  Car ", target: "3 000", date: "2027-06-15", icon: "🚗", source: "manual" };

describe("parseGoalForm", () => {
  it("parses a complete goal", () => {
    expect(parseGoalForm(valid, { today })).toEqual({
      ok: true,
      value: { name: "Car", targetCents: 300_000, targetDate: "2027-06-15", icon: "🚗", source: { kind: "manual" } },
    });
  });

  it("accepts an account id as the source, and empty date and icon", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const result = parseGoalForm({ ...valid, date: "", icon: "", source: id }, { today });
    expect(result).toMatchObject({ ok: true, value: { targetDate: null, icon: null, source: { kind: "account", accountId: id } } });
  });

  it.each([
    [{ name: "  " }, "nameRequired"],
    [{ name: "x".repeat(61) }, "nameTooLong"],
    [{ target: "" }, "targetRequired"],
    [{ target: "abc" }, "targetInvalid"],
    [{ target: "0" }, "targetNotPositive"],
    [{ target: "10000001" }, "targetTooLarge"],
    [{ date: "2027-02-30" }, "dateInvalid"],
    [{ date: "2026-09-29" }, "datePast"],
    [{ icon: "car" }, "iconInvalid"],
    [{ source: "savings" }, "sourceInvalid"],
  ])("refuses %o with %s", (patch, error) => {
    expect(parseGoalForm({ ...valid, ...patch }, { today })).toEqual({ ok: false, error });
  });

  it("allows today, and keeps an unchanged past date", () => {
    expect(parseGoalForm({ ...valid, date: today }, { today }).ok).toBe(true);
    expect(parseGoalForm({ ...valid, date: "2026-06-01" }, { today, previousDate: "2026-06-01" }).ok).toBe(true);
    expect(parseGoalForm({ ...valid, date: "2026-06-02" }, { today, previousDate: "2026-06-01" })).toEqual({
      ok: false,
      error: "datePast",
    });
  });
});

describe("parseContributionForm", () => {
  it("signs the amount by direction", () => {
    expect(parseContributionForm({ amount: "150,50", date: today, direction: "add" }, { today })).toEqual({
      ok: true,
      value: { amountCents: 15_050, date: today },
    });
    expect(parseContributionForm({ amount: "20", date: "2026-09-01", direction: "remove" }, { today })).toEqual({
      ok: true,
      value: { amountCents: -2_000, date: "2026-09-01" },
    });
  });

  it.each([
    [{ amount: "" }, "amountRequired"],
    [{ amount: "1,234" }, "amountInvalid"],
    [{ amount: "-5" }, "amountNotPositive"],
    [{ date: "2026-10-01" }, "dateFuture"],
    [{ date: "30/09/2026" }, "dateInvalid"],
    [{ direction: "steal" }, "directionInvalid"],
  ])("refuses %o with %s", (patch, error) => {
    expect(parseContributionForm({ amount: "10", date: today, direction: "add", ...patch }, { today })).toEqual({
      ok: false,
      error,
    });
  });
});
