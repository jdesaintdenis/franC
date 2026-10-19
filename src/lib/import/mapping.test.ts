// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { columnIndex, completeMapping, guessMapping, prefillMapping, type CsvMapping } from "./mapping";
import { readCsvTable } from "./table";

const sample = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "latin1");
const table = (text: string) => readCsvTable(text)!;

describe("guessMapping", () => {
  it("finds every column of the sample export", () => {
    expect(guessMapping(table(sample))).toEqual({
      date: "Date operation",
      label: "Libelle operation",
      amountKind: "split",
      amount: null,
      debit: "Debit",
      credit: "Credit",
      shortLabel: "Libelle simplifie",
      bookedOn: "Date de comptabilisation",
      category: "Categorie",
      subcategory: "Sous categorie",
      dateFormat: "DD/MM/YYYY",
      decimal: ",",
    });
  });

  it("reads English headers, ISO dates and a dot decimal", () => {
    const d = guessMapping(table("Date,Description,Amount\n2025-09-30,Rent,-1200.50\n2025-10-01,Salary,2500.00"));
    expect(d).toMatchObject({ date: "Date", label: "Description", amountKind: "single", amount: "Amount", dateFormat: "YYYY-MM-DD", decimal: "." });
  });

  it("prefers the operation date over the value date and leaves unknown headers empty", () => {
    const d = guessMapping(table("Date de valeur;Date d'operation;Quoi;Combien\n01/09/2025;02/09/2025;A;-1,00"));
    expect(d.date).toBe("Date d'operation");
    expect(d.label).toBeNull();
    expect(d.amount).toBeNull();
  });

  it("uses a lone short label as the label", () => {
    expect(guessMapping(table("Date;Libelle simplifie;Montant\n01/09/2025;A;-1,00"))).toMatchObject({ label: "Libelle simplifie", shortLabel: null });
  });
});

describe("completeMapping", () => {
  it("is null until date, label and the amount column(s) are chosen", () => {
    const d = guessMapping(table("Date;Quoi;Combien\n01/09/2025;A;-1,00"));
    expect(completeMapping(d)).toBeNull();
    expect(completeMapping({ ...d, label: "Quoi", amount: "Combien" })).toMatchObject({ amount: { kind: "single", column: "Combien" } });
    expect(completeMapping({ ...d, label: "Quoi", amountKind: "split", debit: "Combien", credit: null })).toBeNull();
  });
});

describe("columnIndex", () => {
  it("ignores accents, case and separators", () => {
    expect(columnIndex(["Date", "Libellé", "Date_operation"], "LIBELLE")).toBe(1);
    expect(columnIndex(["Date", "Libellé", "Date_operation"], "date operation")).toBe(2);
    expect(columnIndex(["Date"], "Nope")).toBe(-1);
  });
});

describe("prefillMapping", () => {
  const t = table("Quand;Quoi;Combien\n2025-09-30;Rent;-12.50");
  const mapping = (over: Partial<CsvMapping> = {}): CsvMapping => ({
    date: "Quand",
    label: "Quoi",
    amount: { kind: "single", column: "Combien" },
    shortLabel: null,
    bookedOn: null,
    category: null,
    subcategory: null,
    dateFormat: "YYYY-MM-DD",
    decimal: ".",
    ...over,
  });

  it("takes this account's mapping first, then the latest one", () => {
    const saved = mapping({ decimal: "," });
    expect(prefillMapping(t, saved, mapping())).toMatchObject({ remembered: true, draft: { decimal: "," } });
    expect(prefillMapping(t, null, mapping())).toMatchObject({ remembered: true, draft: { decimal: "." } });
  });

  it("skips a remembered mapping whose columns are not in the file, and guesses", () => {
    const other = mapping({ date: "Date operation" });
    const r = prefillMapping(t, other, other);
    expect(r.remembered).toBe(false);
    expect(r.draft.date).toBeNull();
  });

  it("spells the columns as this file does", () => {
    expect(prefillMapping(t, mapping({ date: "QUAND" }), null).draft.date).toBe("Quand");
  });
});
