// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { dedupeKey, partitionByExisting } from "./index";
import { prepareImportGuessed } from "./prepare-guessed";
import type { KeyedTransaction } from "./index";

const sample = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "utf8");
const ACCOUNT = "acc-1";

function prepare(text: string, account = ACCOUNT): KeyedTransaction[] {
  const r = prepareImportGuessed(text, account);
  if (!r.ok) throw new Error(r.fileError);
  return r.transactions;
}

const keys = (txs: KeyedTransaction[]) => txs.map(dedupeKey);

describe("prepareImport on the sample export", () => {
  const txs = prepare(sample);

  it("reports totals", () => {
    const r = prepareImportGuessed(sample, ACCOUNT);
    expect(r).toMatchObject({ ok: true, rowsTotal: 140, errors: [] });
  });

  it("gives the two identical same-day pairs equal hashes with indexes {0,1}", () => {
    for (const label of ["CB LAVERIE DES TILL FACT 090925", "CB BRASSERIE DES QUA FACT 050925"]) {
      const pair = txs.filter((t) => t.labelNormalized === label);
      expect(pair).toHaveLength(2);
      expect(pair[0].dedupeHash).toBe(pair[1].dedupeHash);
      expect(pair.map((t) => t.occurrenceIndex).sort()).toEqual([0, 1]);
    }
  });

  it("has 140 unique (hash, index) keys", () => {
    expect(new Set(keys(txs)).size).toBe(140);
  });

  it("re-parsing yields identical keys", () => {
    expect(keys(prepare(sample))).toEqual(keys(txs));
  });

  it("shuffled rows yield the same key set", () => {
    const [header, ...rows] = sample.split("\r\n").filter((l) => l !== "");
    const shuffled = [...rows].reverse();
    shuffled.push(shuffled.shift() as string);
    const text = [header, ...shuffled].join("\r\n");
    expect(new Set(keys(prepare(text)))).toEqual(new Set(keys(txs)));
  });

  it("re-importing the same file yields zero fresh rows", () => {
    const { fresh, duplicates } = partitionByExisting(prepare(sample), new Set(keys(txs)));
    expect(fresh).toHaveLength(0);
    expect(duplicates).toHaveLength(140);
  });

  it("different accountId gives different hashes", () => {
    const other = prepare(sample, "acc-2");
    expect(other[0].dedupeHash).not.toBe(txs[0].dedupeHash);
  });

  it("overlapping export only inserts new rows, including a third identical row", () => {
    const lines = sample.split("\r\n").filter((l) => l !== "");
    const header = lines[0];
    const rows = lines.slice(1);
    const existing = new Set(keys(prepare(sample)));

    const laundryRow = rows.find((l) => l.includes("CB LAVERIE DES TILL FACT 090925")) as string;
    const thirdLaundry = laundryRow.replace(/;[0-9a-f-]{36};/, ";third-ref;");
    const brandNew = rows[0].replace("PRLV HORIZON TELECOM", "PRLV NEW PAYEE");

    // File B: a subset of A (the two LAVERIE rows plus 10 others), one new
    // row, and a third identical LAVERIE row.
    const laundryRows = rows.filter((l) => l.includes("CB LAVERIE DES TILL FACT 090925"));
    const others = rows.filter((l) => !laundryRows.includes(l)).slice(0, 10);
    const b = prepare([header, ...laundryRows, ...others, brandNew, thirdLaundry].join("\r\n"));

    const { fresh, duplicates } = partitionByExisting(b, existing);
    expect(duplicates).toHaveLength(12);
    expect(fresh.map((t) => [t.labelNormalized, t.occurrenceIndex]).sort()).toEqual([
      ["CB LAVERIE DES TILL FACT 090925", 2],
      ["PRLV NEW PAYEE", 0],
    ]);
  });

  it("propagates file errors", () => {
    expect(prepareImportGuessed("nope", ACCOUNT)).toEqual({ ok: false, fileError: "noTable" });
  });
});
