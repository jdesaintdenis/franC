import { describe, expect, it } from "vitest";

import { pickBookedBalance } from "./balance";
import type { BankBalance } from "./schemas";

const NOW = new Date("2026-10-02T22:30:00Z"); // 3 Oct, 00:30 in Paris

const bal = (type: string, amount: string, over: Partial<BankBalance> = {}): BankBalance => ({
  balance_type: type,
  balance_amount: { amount, currency: "EUR" },
  ...over,
});

describe("pickBookedBalance", () => {
  it("prefers CLBD, then ITBD, then OTHR", () => {
    const all = [bal("OTHR", "3.00"), bal("ITBD", "2.00"), bal("CLBD", "1.00")];
    expect(pickBookedBalance(all, NOW)?.balanceType).toBe("CLBD");
    expect(pickBookedBalance(all.slice(0, 2), NOW)?.balanceType).toBe("ITBD");
    expect(pickBookedBalance(all.slice(0, 1), NOW)?.balanceType).toBe("OTHR");
  });

  it("never uses expected or available balances", () => {
    expect(pickBookedBalance([bal("XPCD", "1.00"), bal("ITAV", "2.00")], NOW)).toBeNull();
  });

  it("ignores non-EUR and malformed amounts and falls through to the next type", () => {
    const usd = bal("CLBD", "1.00", { balance_amount: { amount: "1.00", currency: "USD" } });
    expect(pickBookedBalance([usd, bal("ITBD", "2.00")], NOW)).toMatchObject({ balanceType: "ITBD", amountCents: 200 });
    expect(pickBookedBalance([bal("CLBD", "12,5"), bal("OTHR", "abc")], NOW)).toBeNull();
    expect(pickBookedBalance([bal("CLBD", "99999999999.00")], NOW)).toBeNull();
    expect(pickBookedBalance([], NOW)).toBeNull();
  });

  it("parses amounts to cents without floats, signed or not", () => {
    expect(pickBookedBalance([bal("CLBD", "1234.5")], NOW)?.amountCents).toBe(123450);
    expect(pickBookedBalance([bal("CLBD", "-42.10")], NOW)?.amountCents).toBe(-4210);
    expect(pickBookedBalance([bal("CLBD", "0.10")], NOW)?.amountCents).toBe(10);
  });

  it("dates it by reference_date, else the Paris day of the last change, else the Paris day of the fetch", () => {
    expect(pickBookedBalance([bal("CLBD", "1", { reference_date: "2026-09-30" })], NOW)?.date).toBe("2026-09-30");
    expect(
      pickBookedBalance([bal("CLBD", "1", { last_change_date_time: "2026-09-30T22:30:00Z" })], NOW)?.date,
    ).toBe("2026-10-01");
    expect(pickBookedBalance([bal("CLBD", "1")], NOW)?.date).toBe("2026-10-03");
    expect(pickBookedBalance([bal("CLBD", "1", { reference_date: "nope" })], NOW)?.date).toBe("2026-10-03");
  });
});
