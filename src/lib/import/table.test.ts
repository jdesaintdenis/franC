// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readCsvTable } from "./table";

describe("readCsvTable", () => {
  it("detects the delimiter", () => {
    expect(readCsvTable("a;b;c\n1;2;3")?.headers).toEqual(["a", "b", "c"]);
    expect(readCsvTable("a,b,c\n1,2,3")?.headers).toEqual(["a", "b", "c"]);
    expect(readCsvTable("a\tb\tc\n1\t2\t3")?.headers).toEqual(["a", "b", "c"]);
  });

  it("skips lines above the table and keeps true line numbers", () => {
    const t = readCsvTable("Compte;123\n\nDate;Label;Amount\n01/09/2025;A;-1,00\n02/09/2025;B;-2,00");
    expect(t?.headers).toEqual(["Date", "Label", "Amount"]);
    expect(t?.rows.map((r) => r.line)).toEqual([4, 5]);
  });

  it("strips a BOM and trims headers", () => {
    expect(readCsvTable("﻿ Date ;Label\n1;2")?.headers).toEqual(["Date", "Label"]);
  });

  it.each([
    ["empty", ""],
    ["one column", "a\n1\n2"],
    ["header only", "a;b;c"],
  ])("returns null for %s", (_n, text) => {
    expect(readCsvTable(text)).toBeNull();
  });
});
