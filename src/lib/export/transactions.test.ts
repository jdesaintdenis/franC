import { describe, expect, it } from "vitest";

import { toCsv, type CsvCell } from "./csv";
import { TRANSACTION_COLUMNS, transactionLines, type ExportTransaction } from "./transactions";

const words = { categorySource: (code: string) => `src:${code}` };

const base: ExportTransaction = {
  date: "2025-09-29",
  accountName: "Main",
  merchantName: null,
  labelDisplay: "Orange",
  labelRaw: "PRLV ORANGE BOX",
  amountCents: -6650,
  category: { name: "Internet et telephonie", parentName: "Logement - maison" },
  categorySource: "bank",
  bankCategory: "Logement - maison",
  bankSubcategory: "Internet et telephonie",
  transferAccountName: null,
  tags: [],
  note: null,
  split: null,
};

const values = (line: CsvCell[]) => line.map((c) => c.value);
const col = (name: (typeof TRANSACTION_COLUMNS)[number]) => TRANSACTION_COLUMNS.indexOf(name);

describe("transactionLines", () => {
  it("writes one line in column order for a plain row", () => {
    const [line] = transactionLines([base], ".", words);
    expect(values(line)).toEqual([
      "2025-09-29",
      "Main",
      "Orange",
      "-66.50",
      "Logement - maison",
      "Internet et telephonie",
      "",
      "",
      "",
      "src:bank",
      "Logement - maison",
      "Internet et telephonie",
      "PRLV ORANGE BOX",
      "",
      "",
    ]);
    expect(line).toHaveLength(TRANSACTION_COLUMNS.length);
  });

  it("uses the decimal separator and passes the date through", () => {
    const [line] = transactionLines([{ ...base, amountCents: 289640, date: "2025-09-29" }], ",", words);
    expect(line[col("amount")].value).toBe("2896,40");
    expect(line[col("date")].value).toBe("2025-09-29");
  });

  it("falls back to the raw label, and empties a missing one", () => {
    const [a] = transactionLines([{ ...base, labelDisplay: null }], ".", words);
    expect(a[col("label")].value).toBe("PRLV ORANGE BOX");
    const [b] = transactionLines([{ ...base, labelDisplay: null, labelRaw: null }], ".", words);
    expect(b[col("label")].value).toBe("");
    expect(b[col("bankLabel")].value).toBe("");
  });

  it("puts a top-level category in Category only, and an uncategorized row nowhere", () => {
    const [top] = transactionLines([{ ...base, category: { name: "Salaire", parentName: null } }], ".", words);
    expect([top[col("category")].value, top[col("subcategory")].value]).toEqual(["Salaire", ""]);
    const [none] = transactionLines(
      [{ ...base, category: null, categorySource: null, bankCategory: null, bankSubcategory: null }],
      ".",
      words,
    );
    expect(values(none).slice(col("category"), col("subcategory") + 1)).toEqual(["", ""]);
    expect(none[col("categorySource")].value).toBe("");
  });

  it("writes the other account of a transfer", () => {
    const [line] = transactionLines(
      [{ ...base, amountCents: 289640, transferAccountName: "Savings", labelRaw: "VIR SEPA ATELIER LUMEN" }],
      ".",
      words,
    );
    expect(line[col("transfer")].value).toBe("Savings");
  });

  it("does not guard amounts but guards a crafted label", () => {
    const out = toCsv(["a"], transactionLines([{ ...base, labelDisplay: "=HYPERLINK(1)" }], ".", words).map((l) => [l[2], l[3]]), {
      delimiter: ",",
    });
    expect(out).toContain("'=HYPERLINK(1),-66.50");
  });

  it("writes sorted tags joined by a comma and the note in the last two columns", () => {
    expect(TRANSACTION_COLUMNS.slice(-2)).toEqual(["tags", "note"]);
    const [line] = transactionLines([{ ...base, tags: ["Holidays 2026", "Work"], note: "Trip, day 1" }], ".", words);
    expect(line[col("tags")].value).toBe("Holidays 2026, Work");
    expect(line[col("note")].value).toBe("Trip, day 1");
  });

  it("guards a note starting with = like any text cell", () => {
    const lines = transactionLines([{ ...base, note: "=1+1", tags: ["-x"] }], ".", words);
    const out = toCsv(["a", "b"], lines.map((l) => [l[col("tags")], l[col("note")]]), { delimiter: ";" });
    expect(out).toContain("'-x;'=1+1");
  });

  describe("split rows", () => {
    const split: ExportTransaction = {
      ...base,
      amountCents: -6650,
      category: { name: "Ignored", parentName: null },
      categorySource: "manual",
      split: {
        total: 3,
        parts: [
          { number: 1, category: { name: "Internet", parentName: "Logement" }, amountCents: -3000 },
          { number: 2, category: { name: "Mobile", parentName: null }, amountCents: -3000 },
          { number: 3, category: null, amountCents: -650 },
        ],
      },
    };

    it("writes one numbered line per part with the full amount, summing to the total", () => {
      const lines = transactionLines([split], ".", words);
      expect(lines.map((l) => l[col("split")].value)).toEqual(["1/3", "2/3", "3/3"]);
      expect(lines.map((l) => l[col("transactionAmount")].value)).toEqual(["-66.50", "-66.50", "-66.50"]);
      expect(lines.map((l) => l[col("amount")].value)).toEqual(["-30.00", "-30.00", "-6.50"]);
      const sum = lines.reduce((s, l) => s + Math.round(Number(l[col("amount")].value) * 100), 0);
      expect(sum).toBe(-6650);
    });

    it("uses the part's category, never the row's, and no category source", () => {
      const lines = transactionLines([split], ".", words);
      expect(lines.map((l) => [l[col("category")].value, l[col("subcategory")].value])).toEqual([
        ["Logement", "Internet"],
        ["Mobile", ""],
        ["", ""],
      ]);
      expect(lines.every((l) => l[col("categorySource")].value === "")).toBe(true);
    });

    it("repeats the tags and note on every part line", () => {
      const lines = transactionLines([{ ...split, tags: ["Trip"], note: "shared" }], ".", words);
      expect(lines.map((l) => [l[col("tags")].value, l[col("note")].value])).toEqual([
        ["Trip", "shared"],
        ["Trip", "shared"],
        ["Trip", "shared"],
      ]);
    });

    it("keeps the original numbering when only some parts are written", () => {
      const only = { ...split, split: { total: 3, parts: [split.split!.parts[1]] } };
      const lines = transactionLines([only], ".", words);
      expect(lines).toHaveLength(1);
      expect(lines[0][col("split")].value).toBe("2/3");
    });
  });
});

describe("transactionLines: merchant name", () => {
  it("writes the merchant name in the label column and keeps the bank label", () => {
    const [line] = transactionLines([{ ...base, merchantName: "Orange Mobile" }], ".", words);
    expect(line[col("label")].value).toBe("Orange Mobile");
    expect(line[col("bankLabel")].value).toBe("PRLV ORANGE BOX");
  });
});
