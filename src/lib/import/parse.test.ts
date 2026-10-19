// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { completeMapping, guessMapping, type CsvMapping } from "./mapping";
import { parseWithMapping } from "./parse";
import { readCsvTable } from "./table";

const HEADER =
  "Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation";

const sample = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "latin1");

function row(over: Partial<Record<"book" | "label" | "debit" | "credit" | "op", string>> = {}) {
  const f = { book: "29/09/2025", label: "CB TEST FACT 250925", debit: "-10,00", credit: "", op: "28/09/2025", ...over };
  return `${f.book};TEST;${f.label};REF1;;Carte bancaire;Cat;Sub;${f.debit};${f.credit};${f.op};${f.book};0`;
}

function parseOk(text: string, mapping?: CsvMapping) {
  const table = readCsvTable(text);
  if (!table) throw new Error("no table");
  const m = mapping ?? completeMapping(guessMapping(table));
  if (!m) throw new Error("no mapping");
  const result = parseWithMapping(table, m);
  if (!result.ok) throw new Error(`unexpected file error: ${result.fileError}`);
  return result;
}

describe("parseWithMapping with the sample export", () => {
  const result = parseOk(sample);

  it("yields 140 transactions and no errors", () => {
    expect(result.transactions).toHaveLength(140);
    expect(result.errors).toEqual([]);
  });

  it("parses the first row and the credit row", () => {
    expect(result.transactions[0]).toMatchObject({
      line: 2,
      date: "2025-09-30",
      amountCents: -4299,
      labelRaw: "PRLV HORIZON TELECOM",
      labelSimplified: "HORIZON TELECOM",
    });
    expect(result.transactions[1]).toMatchObject({ date: "2025-09-30", amountCents: 289640 });
  });

  it("keeps the bank categories and drops the placeholders", () => {
    expect(result.transactions[0]).toMatchObject({ bankCategory: "Logement - maison", bankSubcategory: "Internet et telephonie" });
    expect(result.transactions[1]).toMatchObject({ bankCategory: null, bankSubcategory: null });
    expect(result.transactions[3]).toMatchObject({ bankCategory: "Transaction exclue", bankSubcategory: "Virement interne" });
  });

  it("uses the operation date, not the booking date", () => {
    expect(result.transactions[2]).toMatchObject({ date: "2025-09-29", amountCents: -6000 });
  });
});

describe("parseWithMapping validation", () => {
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
      row({ label: "CB OK 2" }),
    ].join("\r\n");
    const result = parseOk(text);
    expect(result.transactions.map((t) => t.line)).toEqual([2, 9]);
    expect(result.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(result.errors.map((e) => e.issues)).toEqual([
      [{ code: "invalidDate" }],
      [{ code: "debitCreditExclusive" }],
      [{ code: "debitCreditExclusive" }],
      [{ code: "malformedAmount" }],
      [{ code: "columnCount", expected: 13, found: 3 }],
      [{ code: "emptyLabel" }],
    ]);
  });

  it("takes the sign from the Debit / Credit column, whatever sign the bank wrote", () => {
    const result = parseOk([HEADER, row({ debit: "+5,00" }), row({ debit: "", credit: "-5,00", label: "CB B" })].join("\n"));
    expect(result.transactions.map((t) => t.amountCents)).toEqual([-500, 500]);
  });

  it("lets a zero sit next to the real value", () => {
    const result = parseOk([HEADER, row({ debit: "0,00", credit: "12,00" }), row({ debit: "-3,00", credit: "0,00", label: "CB B" })].join("\n"));
    expect(result.transactions.map((t) => t.amountCents)).toEqual([1200, -300]);
  });

  it("reports an invalid booking date and reads an empty one as none", () => {
    expect(parseOk([HEADER, row({ book: "99/09/2025" })].join("\n")).errors[0].issues).toEqual([{ code: "invalidDate" }]);
    const none = parseOk([HEADER, row({ book: "" })].join("\n"));
    expect(none.transactions[0].bookedOn).toBeNull();
  });

  it("keeps true line numbers when blank lines precede a bad row", () => {
    expect(parseOk([HEADER, row(), "", row({ debit: "" })].join("\n")).errors.map((e) => e.line)).toEqual([4]);
  });

  it("skips delimiter-only rows without shifting line numbers", () => {
    const result = parseOk([HEADER, ";;;;;;;;;;;;", "  ", row({ debit: "" }), row()].join("\r\n"));
    expect(result.errors.map((e) => e.line)).toEqual([4]);
    expect(result.transactions.map((t) => t.line)).toEqual([5]);
  });

  it("parses CRLF, LF, BOM and trailing blank lines identically", () => {
    const lf = sample.replace(/\r\n/g, "\n");
    const base = parseOk(sample);
    for (const v of [lf, `﻿${sample}`, `${sample}\r\n\r\n`, `${lf}\n\n`]) expect(parseOk(v)).toEqual(base);
  });

  it("reports a mapped column the file does not have", () => {
    const table = readCsvTable([HEADER, row()].join("\n"))!;
    const mapping = completeMapping({ ...guessMapping(table), label: "Nope" })!;
    expect(parseWithMapping(table, mapping)).toEqual({ ok: false, fileError: "columnMissing" });
  });
});

describe("parseWithMapping on another bank's layout", () => {
  const text = ["Compte;123456", "Date,Description,Amount", "2025-09-30,Rent,\"-1,200.50\"", "2025-10-01,Salary,\"2,500.00\""].join("\n");

  it("reads ISO dates and a dot decimal after a preamble line", () => {
    const result = parseOk(text);
    expect(result.transactions.map((t) => [t.line, t.date, t.amountCents, t.labelRaw])).toEqual([
      [3, "2025-09-30", -120050, "Rent"],
      [4, "2025-10-01", 250000, "Salary"],
    ]);
  });
});
