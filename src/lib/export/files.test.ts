import { describe, expect, it } from "vitest";

import { toCsv } from "./csv";
import { budgetLines, categoryLines, ruleLines } from "./files";

const values = (lines: { value: string }[][]) => lines.map((l) => l.map((c) => c.value));

describe("categoryLines", () => {
  it("lists parents by name (case-insensitive) each followed by its children by name", () => {
    const rows = [
      { id: "3", name: "internet", parentId: "1", color: "#111111", icon: null },
      { id: "1", name: "Logement", parentId: null, color: "#aaaaaa", icon: "🏠" },
      { id: "4", name: "Assurance", parentId: "1", color: "#222222", icon: null },
      { id: "2", name: "alimentation", parentId: null, color: "#bbbbbb", icon: null },
    ];
    expect(values(categoryLines(rows))).toEqual([
      ["alimentation", "", "#bbbbbb", ""],
      ["Logement", "", "#aaaaaa", "🏠"],
      ["Logement", "Assurance", "#222222", ""],
      ["Logement", "internet", "#111111", ""],
    ]);
  });
});

describe("categoryLines with emoji icons", () => {
  const rows = [
    { id: "1", name: "Famille", parentId: null, color: "#aaaaaa", icon: "👨‍👩‍👧" },
    { id: "2", name: "Maison, jardin", parentId: "1", color: "#bbbbbb", icon: "🇫🇷" },
  ];

  it.each([
    [",", "category,subcategory,color,icon\r\nFamille,,#aaaaaa,👨‍👩‍👧\r\nFamille,\"Maison, jardin\",#bbbbbb,🇫🇷\r\n"],
    [";", "category;subcategory;color;icon\r\nFamille;;#aaaaaa;👨‍👩‍👧\r\nFamille;Maison, jardin;#bbbbbb;🇫🇷\r\n"],
  ] as const)("writes the emoji as is with the %s delimiter, quoting only what needs it", (delimiter, expected) => {
    const csv = toCsv(["category", "subcategory", "color", "icon"], categoryLines(rows), { delimiter });
    expect(csv).toBe("\uFEFF" + expected);
  });
});

describe("ruleLines", () => {
  it("keeps the given order and translates the match type", () => {
    const lines = ruleLines(
      [
        { priority: 0, matchType: "contains", pattern: "ORANGE", categoryName: "Internet", parentName: "Logement" },
        { priority: 1, matchType: "regex", pattern: "^VIR,", categoryName: "Salaire", parentName: null },
      ],
      { matchType: (c) => `mt:${c}` },
    );
    expect(values(lines)).toEqual([
      ["0", "mt:contains", "ORANGE", "Logement", "Internet"],
      ["1", "mt:regex", "^VIR,", "Salaire", ""],
    ]);
    expect(lines[0][0].kind).toBe("number");
  });
});

describe("budgetLines", () => {
  it("orders by category then subcategory and formats amounts", () => {
    const lines = budgetLines(
      [
        { categoryName: "Internet", parentName: "Logement", amountCents: 6650, rollover: false },
        { categoryName: "Logement", parentName: null, amountCents: 90000, rollover: false },
        { categoryName: "Alimentation", parentName: null, amountCents: 45050, rollover: true },
      ],
      ",",
      { yesNo: (v) => (v ? "Oui" : "Non") },
    );
    expect(values(lines)).toEqual([
      ["Alimentation", "", "450,50", "Oui"],
      ["Logement", "", "900,00", "Non"],
      ["Logement", "Internet", "66,50", "Non"],
    ]);
  });
});
