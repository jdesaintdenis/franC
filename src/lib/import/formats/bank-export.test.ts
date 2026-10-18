// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { bankExportFormat } from "./bank-export";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

const sample = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "utf8");

function row(over: Partial<Record<"book" | "label" | "debit" | "credit" | "op", string>> = {}) {
  const f = { book: "29/09/2025", label: "CB TEST FACT 250925", debit: "-10,00", credit: "", op: "28/09/2025", ...over };
  return `${f.book};TEST;${f.label};REF1;;Carte bancaire;Cat;Sub;${f.debit};${f.credit};${f.op};${f.book};0`;
}

function parseOk(text: string) {
  const result = bankExportFormat.parse(text);
  if (!result.ok) throw new Error(`unexpected file error: ${result.fileError}`);
  return result;
}

describe("bankExportFormat with the sample export", () => {
  const result = parseOk(sample);

  it("yields 140 transactions and no errors", () => {
    expect(result.transactions).toHaveLength(140);
    expect(result.errors).toEqual([]);
  });

  it("parses the first row", () => {
    expect(result.transactions[0]).toMatchObject({
      line: 2,
      date: "2025-09-30",
      amountCents: -4299,
      labelRaw: "PRLV HORIZON TELECOM",
      labelSimplified: "HORIZON TELECOM",
    });
  });

  it("parses the credit row", () => {
    expect(result.transactions[1]).toMatchObject({ date: "2025-09-30", amountCents: 289640 });
  });

  it("keeps the bank categories and drops the placeholders", () => {
    expect(result.transactions[0]).toMatchObject({
      bankCategory: "Logement - maison",
      bankSubcategory: "Internet et telephonie",
    });
    // Lines 3 and 4: "A categoriser - ..." clears both columns.
    expect(result.transactions[1]).toMatchObject({ bankCategory: null, bankSubcategory: null });
    expect(result.transactions[2]).toMatchObject({ bankCategory: null, bankSubcategory: null });
    expect(result.transactions[3]).toMatchObject({
      bankCategory: "Transaction exclue",
      bankSubcategory: "Virement interne",
    });
  });

  it("uses the operation date, not the booking date", () => {
    // Line 4: booked 30/09, operated 29/09.
    expect(result.transactions[2]).toMatchObject({ date: "2025-09-29", amountCents: -6000 });
  });
});

describe("bankExportFormat validation", () => {
  it("reports invalid rows with file line numbers and keeps valid ones", () => {
    const text = [
      HEADER,
      row(),
      row({ op: "31/02/2025" }), // line 3
      row({ debit: "-1,00", credit: "+2,00" }), // line 4
      row({ debit: "" }), // line 5
      row({ debit: "-1.5" }), // line 6
      "a;b;c", // line 7
      row({ label: "  " }), // line 8
      row({ debit: "+5,00" }), // line 9
      row({ debit: "", credit: "-5,00" }), // line 10
      row({ label: "CB OK 2" }),
    ].join("\r\n");
    const result = parseOk(text);
    expect(result.transactions.map((t) => t.line)).toEqual([2, 11]);
    expect(result.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.errors.map((e) => e.issues)).toEqual([
      [{ code: "invalidDate" }],
      [{ code: "debitCreditExclusive" }],
      [{ code: "debitCreditExclusive" }],
      [{ code: "malformedAmount" }],
      [{ code: "columnCount", expected: 13, found: 3 }],
      [{ code: "emptyLabel" }],
      [{ code: "debitPositive" }],
      [{ code: "creditNegative" }],
    ]);
  });

  it("reports an invalid booking date", () => {
    const result = parseOk([HEADER, row({ book: "99/09/2025" })].join("\n"));
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].issues).toEqual([{ code: "invalidDate" }]);
  });

  it("keeps true line numbers when blank lines precede a bad row", () => {
    const result = parseOk([HEADER, row(), "", row({ debit: "" })].join("\n"));
    expect(result.errors.map((e) => e.line)).toEqual([4]);
  });

  it("skips delimiter-only rows without shifting line numbers", () => {
    const result = parseOk([HEADER, ";;;;;;;;;;;;", "  ", row({ debit: "" }), row()].join("\r\n"));
    expect(result.errors.map((e) => e.line)).toEqual([4]);
    expect(result.transactions.map((t) => t.line)).toEqual([5]);
  });

  it.each([
    ["wrong header", "Date;Libelle\r\n1;2"],
    ["empty file", ""],
    ["missing header", row()],
  ])("returns a file error code for %s", (_name, text) => {
    expect(bankExportFormat.parse(text)).toEqual({ ok: false, fileError: "unrecognizedHeader" });
  });

  it("parses CRLF, LF, BOM and trailing blank lines identically", () => {
    const lf = sample.replace(/\r\n/g, "\n");
    const variants = [lf, `\uFEFF${sample}`, `${sample}\r\n\r\n`, `${lf}\n\n`];
    const base = parseOk(sample);
    for (const v of variants) expect(parseOk(v)).toEqual(base);
  });
});
