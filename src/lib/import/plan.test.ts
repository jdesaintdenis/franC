// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Decision } from "../bank-sync/match";
import { dedupeKey } from "./dedupe";
import { prepareImportGuessed } from "./prepare-guessed";
import { offersBulkReview } from "./bulk-review";
import { buildImportPlan, cashFlows, dateRangeOf, sampleRows } from "./plan";

const sample = readFileSync(join(process.cwd(), "docs/samples/sample-export.csv"), "utf-8");
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";

function prepared() {
  const result = prepareImportGuessed(sample, ACCOUNT_ID);
  if (!result.ok) throw new Error(result.fileError);
  return result;
}

describe("buildImportPlan", () => {
  it("counts everything as new when nothing exists", () => {
    const p = prepared();
    const plan = buildImportPlan(p, new Set());
    expect(plan.counts).toEqual({
      total: p.rowsTotal,
      new: p.transactions.length,
      duplicate: 0,
      possible: 0,
      error: p.errors.length,
    });
    expect(plan.fresh).toHaveLength(p.transactions.length);
  });

  it("moves already-stored keys to duplicates", () => {
    const p = prepared();
    const existing = new Set(p.transactions.slice(0, 30).map(dedupeKey));
    const plan = buildImportPlan(p, existing);
    expect(plan.counts.duplicate).toBe(30);
    expect(plan.counts.new).toBe(p.transactions.length - 30);
    expect(plan.fresh.some((t) => existing.has(dedupeKey(t)))).toBe(false);
  });

  it("uses the matcher's verdicts: merges are duplicates, possible rows are new and counted", () => {
    const p = prepared();
    const decisions: Decision[] = p.transactions.map(() => ({ kind: "insert" }));
    decisions[0] = { kind: "duplicate", targetId: "a", link: false };
    decisions[1] = { kind: "merge", targetId: "b" };
    decisions[2] = { kind: "possible", candidateIds: ["c", "d"] };
    const plan = buildImportPlan(p, decisions);
    expect(plan.counts).toMatchObject({ new: p.transactions.length - 2, duplicate: 2, possible: 1 });
    expect(plan.fresh).toHaveLength(p.transactions.length - 2);
    expect(plan.fresh[0]).toBe(p.transactions[2]);
  });

  it("passes row errors through", () => {
    const errors = [{ line: 5, issues: [{ code: "invalidDate" as const }] }];
    const plan = buildImportPlan({ transactions: [], errors, rowsTotal: 1 }, new Set());
    expect(plan.counts).toEqual({ total: 1, new: 0, duplicate: 0, possible: 0, error: 1 });
    expect(plan.errors).toBe(errors);
  });
});

describe("sampleRows", () => {
  it("returns the first 10 by default and honours n", () => {
    const { transactions } = prepared();
    expect(sampleRows(transactions)).toEqual(transactions.slice(0, 10));
    expect(sampleRows(transactions, 3)).toHaveLength(3);
    expect(sampleRows(transactions.slice(0, 2))).toHaveLength(2);
  });
});

describe("dateRangeOf", () => {
  it("returns the earliest and latest date whatever the order", () => {
    expect(dateRangeOf([{ date: "2026-03-02" }, { date: "2025-10-12" }, { date: "2026-09-29" }])).toEqual({
      from: "2025-10-12",
      to: "2026-09-29",
    });
  });
  it("is one day for one row and null for none", () => {
    expect(dateRangeOf([{ date: "2026-03-02" }])).toEqual({ from: "2026-03-02", to: "2026-03-02" });
    expect(dateRangeOf([])).toBeNull();
  });
});

describe("offersBulkReview", () => {
  it("offers it for a first import or 50+ rows, never for nothing", () => {
    expect(offersBulkReview({ firstImport: true, inserted: 3 })).toBe(true);
    expect(offersBulkReview({ firstImport: false, inserted: 50 })).toBe(true);
    expect(offersBulkReview({ firstImport: false, inserted: 49 })).toBe(false);
    expect(offersBulkReview({ firstImport: true, inserted: 0 })).toBe(false);
  });
});

describe("cashFlows", () => {
  it("is zero for no rows", () => {
    expect(cashFlows([])).toEqual({ inCents: 0, outCents: 0, netCents: 0 });
  });

  it("splits credits and debits and nets them", () => {
    expect(cashFlows([{ amountCents: 10000 }, { amountCents: -2000 }, { amountCents: -550 }])).toEqual({
      inCents: 10000,
      outCents: -2550,
      netCents: 7450,
    });
  });

  it("has no money in when there are only debits", () => {
    expect(cashFlows([{ amountCents: -100 }, { amountCents: -250 }])).toEqual({ inCents: 0, outCents: -350, netCents: -350 });
  });
});
