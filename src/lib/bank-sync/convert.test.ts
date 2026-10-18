import { describe, expect, it } from "vitest";

import { convertBankTransactions, cleanBankLabel, operationDate } from "./convert";
import type { BankTransaction } from "./schemas";

describe("cleanBankLabel", () => {
  it.each([
    ["CB BOULANGERIE DES L FACT 250925 4000XXXX1234", "CB BOULANGERIE DES L FACT 250925"],
    ["CB BOULANGERIE DES L FACT 250925", "CB BOULANGERIE DES L FACT 250925"],
    ["CB GITHUB, INC. FACT 140725 A1B2", "CB GITHUB, INC. FACT 140725"],
    ["RETRAIT DAB 29-09-10001-200001 CARTE1234", "RETRAIT DAB 29-09-10001-200001"],
    ["RETRAIT DAB 29-09-10001-200001", "RETRAIT DAB 29-09-10001-200001"],
    ["  PRLV  ORANGE BOX ", "PRLV ORANGE BOX"],
    ["ECH PRET 100001A DU 06/09/25", "ECH PRET 100001A DU 06/09/25"],
    // A trailing word without digits is part of the name.
    ["CB SHOP FACT 250925 PARIS", "CB SHOP FACT 250925 PARIS"],
  ])("%s → %s", (raw, clean) => {
    expect(cleanBankLabel(raw)).toBe(clean);
  });
});

describe("operationDate", () => {
  it.each([
    ["CB BOULANGERIE DES L FACT 250925", "2025-09-26", "2025-09-25"],
    ["CB SHOP FACT 260925", "2025-09-26", "2025-09-26"],
    ["CB SHOP FACT 311225", "2026-01-02", "2025-12-31"],
    ["CB SHOP FACT 290224", "2024-03-01", "2024-02-29"],
    ["PRLV ORANGE BOX", "2025-09-29", "2025-09-29"],
    ["ECH PRET 100001A DU 06/09/25", "2025-09-08", "2025-09-08"],
    ["CB SHOP FACT 310925", "2025-10-02", "2025-10-02"], // not a real date
    ["CB SHOP FACT 991325", "2025-10-02", "2025-10-02"],
  ])("%s booked %s → %s", (label, booking, expected) => {
    expect(operationDate(label, booking)).toBe(expected);
  });
});

const tx = (over: Partial<BankTransaction> = {}): BankTransaction => ({
  entry_reference: "REF1",
  transaction_amount: { amount: "12.30", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2025-09-26",
  remittance_information: ["PRLV ORANGE BOX"],
  ...over,
});

const convert = (txs: BankTransaction[], learned = new Map<string, string>()) =>
  convertBankTransactions(txs, learned);

describe("convertBankTransactions", () => {
  it("keeps booked rows, skips pending, counts a missing status as booked", () => {
    const res = convert([
      tx({ entry_reference: "A" }),
      tx({ entry_reference: "B", status: "PDNG" }),
      tx({ entry_reference: "C", status: null }),
    ]);
    expect(res.rows.map((r) => r.externalId)).toEqual(["A", "C"]);
    expect(res.skipped).toBe(1);
    expect(res.errors).toEqual([]);
  });

  it("signs amounts in cents and numbers lines from 1", () => {
    const res = convert([
      tx({ entry_reference: "A" }),
      tx({ entry_reference: "B", credit_debit_indicator: "CRDT", transaction_amount: { amount: "1500.5", currency: "EUR" } }),
    ]);
    expect(res.rows.map((r) => [r.line, r.amountCents])).toEqual([
      [1, -1230],
      [2, 150050],
    ]);
  });

  it("reports non-EUR and malformed amounts with their line, collecting all issues", () => {
    const res = convert([
      tx(),
      tx({ transaction_amount: { amount: "5.00", currency: "USD" } }),
      tx({ transaction_amount: { amount: "abc", currency: "EUR" } }),
      tx({ transaction_amount: { amount: "x", currency: "GBP" }, remittance_information: [] }),
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.errors).toEqual([
      { line: 2, issues: [{ code: "nonEur" }] },
      { line: 3, issues: [{ code: "malformedAmount" }] },
      { line: 4, issues: [{ code: "nonEur" }, { code: "malformedAmount" }, { code: "emptyLabel" }] },
    ]);
  });

  describe("label", () => {
    it("joins trimmed remittance lines and cleans the reference", () => {
      const res = convert([tx({ remittance_information: ["  CB SHOP FACT 250925 ", "", "4000XXXX1234"] })]);
      expect(res.rows[0].labelRaw).toBe("CB SHOP FACT 250925");
    });
    it("joins several lines with a space", () => {
      expect(convert([tx({ remittance_information: ["VIR SEPA", "LOYER OCTOBRE"] })]).rows[0].labelRaw).toBe(
        "VIR SEPA LOYER OCTOBRE",
      );
    });
    it("falls back to the debtor for credits and the creditor for debits", () => {
      const parties = { debtor: { name: "ALICE" }, creditor: { name: "BOB" }, remittance_information: [" "] };
      expect(convert([tx({ ...parties, credit_debit_indicator: "CRDT" })]).rows[0].labelRaw).toBe("ALICE");
      expect(convert([tx({ ...parties })]).rows[0].labelRaw).toBe("BOB");
    });
    it("falls back to the bank transaction code description", () => {
      const res = convert([tx({ remittance_information: null, bank_transaction_code: { description: "Frais" } })]);
      expect(res.rows[0].labelRaw).toBe("Frais");
    });
    it("reports emptyLabel when nothing is usable", () => {
      const res = convert([tx({ remittance_information: null, creditor: { name: " " } })]);
      expect(res.errors).toEqual([{ line: 1, issues: [{ code: "emptyLabel" }] }]);
    });
  });

  describe("date", () => {
    it("prefers transaction_date", () => {
      const res = convert([tx({ transaction_date: "2025-09-20", booking_date: "2025-09-26" })]);
      expect(res.rows[0].date).toBe("2025-09-20");
    });
    it("derives the card date from the booking date", () => {
      const res = convert([tx({ remittance_information: ["CB SHOP FACT 250925 1234"] })]);
      expect(res.rows[0].date).toBe("2025-09-25");
    });
    it("uses the booking date as is for other labels", () => {
      expect(convert([tx()]).rows[0].date).toBe("2025-09-26");
    });
    it("falls back to the value date", () => {
      const res = convert([tx({ booking_date: null, value_date: "2025-09-27" })]);
      expect(res.rows[0].date).toBe("2025-09-27");
    });
    it("reports noDate when no date is given", () => {
      const res = convert([tx({ booking_date: null })]);
      expect(res.errors).toEqual([{ line: 1, issues: [{ code: "noDate" }] }]);
    });
    it.each(["2025-02-30", "26/09/2025", "garbage"])("reports noDate for %s", (bad) => {
      expect(convert([tx({ booking_date: bad })]).errors[0].issues).toEqual([{ code: "noDate" }]);
      expect(convert([tx({ transaction_date: bad })]).errors[0].issues).toEqual([{ code: "noDate" }]);
    });
  });

  describe("externalId", () => {
    it("trims the reference", () => {
      expect(convert([tx({ entry_reference: "  X1 " })]).rows[0].externalId).toBe("X1");
    });
    it.each([null, "", "  ", "0", "000000", "0-0", "-"])("treats %j as no id", (ref) => {
      expect(convert([tx({ entry_reference: ref })]).rows[0].externalId).toBeNull();
    });
    it("nulls an id repeated in the same input, even on a skipped row", () => {
      const res = convert([
        tx({ entry_reference: "DUP" }),
        tx({ entry_reference: "DUP" }),
        tx({ entry_reference: "UNIQ" }),
        tx({ entry_reference: "P", status: "PDNG" }),
        tx({ entry_reference: "P" }),
      ]);
      expect(res.rows.map((r) => r.externalId)).toEqual([null, null, "UNIQ", null]);
    });
  });

  describe("short and normalized labels", () => {
    it("uses the learned short label when known", () => {
      const learned = new Map([["BOULANGERIE DES L", "BOULANGERIE DES LILAS"]]);
      const res = convert([tx({ remittance_information: ["CB BOULANGERIE DES L FACT 250925 4000XXXX1234"] })], learned);
      expect(res.rows[0].labelSimplified).toBe("BOULANGERIE DES LILAS");
    });
    it("else strips the bank wrapping", () => {
      const res = convert([tx({ remittance_information: ["PRLV SEPA ORANGE SA"] })]);
      expect(res.rows[0].labelSimplified).toBe("ORANGE SA");
      expect(res.rows[0].labelNormalized).not.toBe("");
      expect(res.rows[0].bankCategory).toBeNull();
      expect(res.rows[0].bankSubcategory).toBeNull();
    });
  });

  describe("bookedOn", () => {
    it("carries the bank's booking date, not the operation date", () => {
      const { rows } = convertBankTransactions(
        [tx({ booking_date: "2025-09-26", remittance_information: ["CB BOULANGERIE DES L FACT 250925 4000XXXX1234"] })],
        new Map(),
      );
      expect(rows[0]).toMatchObject({ date: "2025-09-25", bookedOn: "2025-09-26" });
    });

    it("is null when the bank gave only a value date", () => {
      const { rows } = convertBankTransactions([tx({ booking_date: null, value_date: "2025-09-26" })], new Map());
      expect(rows[0]).toMatchObject({ date: "2025-09-26", bookedOn: null });
    });
  });
});
