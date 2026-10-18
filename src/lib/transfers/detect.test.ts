import { describe, expect, it } from "vitest";

import { detectTransfers, type TransferRow } from "./detect";
import { validateTransferLink } from "./validate";

let n = 0;
function row(over: Partial<TransferRow> & Pick<TransferRow, "accountId" | "date" | "amountCents">): TransferRow {
  n += 1;
  return { id: `id-${String(n).padStart(3, "0")}`, bankSubcategory: null, ...over };
}

describe("detectTransfers", () => {
  it("pairs same-day legs", () => {
    const out = row({ accountId: "A", date: "2026-03-10", amountCents: -5000 });
    const inn = row({ accountId: "B", date: "2026-03-10", amountCents: 5000 });
    expect(detectTransfers([out, inn], [])).toEqual([
      { outTransactionId: out.id, inTransactionId: inn.id, status: "detected" },
    ]);
  });

  it("pairs delayed legs in either order", () => {
    const out = row({ accountId: "A", date: "2026-03-10", amountCents: -5000 });
    const late = row({ accountId: "B", date: "2026-03-13", amountCents: 5000 });
    expect(detectTransfers([out, late], [])).toHaveLength(1);
    const early = row({ accountId: "B", date: "2026-03-07", amountCents: 5000 });
    expect(detectTransfers([out, early], [])).toHaveLength(1);
  });

  it("accepts exactly 4 days and rejects 5", () => {
    const out = row({ accountId: "A", date: "2026-03-10", amountCents: -100 });
    expect(detectTransfers([out, row({ accountId: "B", date: "2026-03-14", amountCents: 100 })], [])).toHaveLength(1);
    expect(detectTransfers([out, row({ accountId: "B", date: "2026-03-15", amountCents: 100 })], [])).toHaveLength(0);
  });

  it("handles month and year boundaries", () => {
    const out = row({ accountId: "A", date: "2025-12-30", amountCents: -100 });
    const inn = row({ accountId: "B", date: "2026-01-02", amountCents: 100 });
    expect(detectTransfers([out, inn], [])).toHaveLength(1);
  });

  it("never pairs within one account", () => {
    const out = row({ accountId: "A", date: "2026-03-10", amountCents: -5000 });
    const inn = row({ accountId: "A", date: "2026-03-10", amountCents: 5000 });
    expect(detectTransfers([out, inn], [])).toEqual([]);
  });

  it("requires exactly equal amounts", () => {
    const out = row({ accountId: "A", date: "2026-03-10", amountCents: -5000 });
    const inn = row({ accountId: "B", date: "2026-03-10", amountCents: 5001 });
    expect(detectTransfers([out, inn], [])).toEqual([]);
  });

  it("skips rejected pairs", () => {
    const out = row({ accountId: "A", date: "2026-03-10", amountCents: -5000 });
    const inn = row({ accountId: "B", date: "2026-03-10", amountCents: 5000 });
    expect(detectTransfers([out, inn], [{ outTransactionId: out.id, inTransactionId: inn.id }])).toEqual([]);
  });

  it("pairs two identical transfers in date order", () => {
    const out1 = row({ accountId: "A", date: "2026-03-01", amountCents: -2000 });
    const out2 = row({ accountId: "A", date: "2026-03-03", amountCents: -2000 });
    const in1 = row({ accountId: "B", date: "2026-03-02", amountCents: 2000 });
    const in2 = row({ accountId: "B", date: "2026-03-04", amountCents: 2000 });
    const pairs = detectTransfers([out2, in2, in1, out1], []);
    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual({ outTransactionId: out1.id, inTransactionId: in1.id, status: "detected" });
    expect(pairs).toContainEqual({ outTransactionId: out2.id, inTransactionId: in2.id, status: "detected" });
  });

  it("prefers the closest candidate", () => {
    const out = row({ accountId: "A", date: "2026-03-10", amountCents: -700 });
    const far = row({ accountId: "B", date: "2026-03-13", amountCents: 700 });
    const near = row({ accountId: "B", date: "2026-03-11", amountCents: 700 });
    expect(detectTransfers([out, far, near], [])).toEqual([
      { outTransactionId: out.id, inTransactionId: near.id, status: "detected" },
    ]);
  });

  it("confirms pairs carrying the bank tag", () => {
    const out = row({ accountId: "A", date: "2026-03-10", amountCents: -5000, bankSubcategory: "Virement interne" });
    const inn = row({ accountId: "B", date: "2026-03-10", amountCents: 5000 });
    expect(detectTransfers([out, inn], [])[0]?.status).toBe("confirmed");
    const out2 = row({ accountId: "A", date: "2026-04-10", amountCents: -5000 });
    const inn2 = row({ accountId: "B", date: "2026-04-10", amountCents: 5000, bankSubcategory: "Virement interne" });
    expect(detectTransfers([out2, inn2], [])[0]?.status).toBe("confirmed");
    const out3 = row({ accountId: "A", date: "2026-05-10", amountCents: -5000, bankSubcategory: "virement interne" });
    const inn3 = row({ accountId: "B", date: "2026-05-10", amountCents: 5000 });
    expect(detectTransfers([out3, inn3], [])[0]?.status).toBe("detected");
  });

  it("does not mark an untagged unpaired row", () => {
    const out = row({ accountId: "A", date: "2026-03-10", amountCents: -5000, bankSubcategory: "Virement interne" });
    expect(detectTransfers([out], [])).toEqual([]);
  });
});

describe("validateTransferLink", () => {
  const out = { accountId: "A", amountCents: -500 };
  const inn = { accountId: "B", amountCents: 500 };
  it("accepts a valid pair", () => expect(validateTransferLink(out, inn)).toBeNull());
  it("rejects wrong signs", () => {
    expect(validateTransferLink(inn, out)).toBe("sameSign");
    expect(validateTransferLink(out, { accountId: "B", amountCents: -500 })).toBe("sameSign");
  });
  it("rejects different amounts", () => {
    expect(validateTransferLink(out, { accountId: "B", amountCents: 501 })).toBe("amountMismatch");
  });
  it("rejects the same account", () => {
    expect(validateTransferLink(out, { accountId: "A", amountCents: 500 })).toBe("sameAccount");
  });
  it("rejects a split row on either side", () => {
    expect(validateTransferLink(out, { accountId: "B", amountCents: 500, isSplit: true })).toBe("split");
    expect(validateTransferLink({ ...out, isSplit: true }, { accountId: "B", amountCents: 500 })).toBe("split");
  });
});
