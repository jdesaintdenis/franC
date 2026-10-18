import { describe, expect, it } from "vitest";

import { amountToInput, MANUAL_LABEL_MAX, parseManualForm } from "./input";

const today = "2026-10-06";
const ok = { amount: "12,50", direction: "expense", label: "Boulangerie", date: "2026-10-05" };

describe("parseManualForm", () => {
  it("makes an expense negative and an income positive, with comma or dot", () => {
    expect(parseManualForm(ok, { today })).toEqual({
      ok: true,
      value: { amountCents: -1250, label: "Boulangerie", date: "2026-10-05" },
    });
    const income = parseManualForm({ ...ok, amount: "12.50", direction: "income" }, { today });
    expect(income.ok && income.value.amountCents).toBe(1250);
  });

  it("treats an unknown direction as an expense", () => {
    const r = parseManualForm({ ...ok, direction: "x" }, { today });
    expect(r.ok && r.value.amountCents).toBe(-1250);
  });

  it.each([
    ["", "amountRequired"],
    ["abc", "amountInvalid"],
    ["0", "amountNotPositive"],
    ["99999999999", "amountTooLarge"],
  ])("refuses amount %j", (amount, error) => {
    expect(parseManualForm({ ...ok, amount }, { today })).toEqual({ ok: false, error });
  });

  it("trims and collapses the label and bounds its length", () => {
    const r = parseManualForm({ ...ok, label: "  Swile   top-up " }, { today });
    expect(r.ok && r.value.label).toBe("Swile top-up");
    expect(parseManualForm({ ...ok, label: "   " }, { today })).toEqual({ ok: false, error: "labelRequired" });
    expect(parseManualForm({ ...ok, label: "x".repeat(MANUAL_LABEL_MAX + 1) }, { today })).toEqual({
      ok: false,
      error: "labelTooLong",
    });
  });

  it("checks the date", () => {
    expect(parseManualForm({ ...ok, date: today }, { today }).ok).toBe(true);
    expect(parseManualForm({ ...ok, date: "2026-10-07" }, { today })).toEqual({ ok: false, error: "dateFuture" });
    expect(parseManualForm({ ...ok, date: "1999-12-31" }, { today })).toEqual({ ok: false, error: "dateTooOld" });
    expect(parseManualForm({ ...ok, date: "2026-02-30" }, { today })).toEqual({ ok: false, error: "dateInvalid" });
    expect(parseManualForm({ ...ok, date: undefined }, { today })).toEqual({ ok: false, error: "dateInvalid" });
  });
});

describe("amountToInput", () => {
  it("writes whole cents without floats and round-trips through the parser", () => {
    expect(amountToInput(-1250)).toBe("12,50");
    expect(amountToInput(5)).toBe("0,05");
    expect(amountToInput(100000)).toBe("1000,00");
    const r = parseManualForm({ ...ok, amount: amountToInput(-1250) }, { today });
    expect(r.ok && r.value.amountCents).toBe(-1250);
  });
});
