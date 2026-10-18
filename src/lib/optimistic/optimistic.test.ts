import { describe, expect, it } from "vitest";

import { patchById, revertPatches, snapshotFields } from "./patch";
import { createSerialQueue } from "./queue";

type Row = { id: string; category: { id: string } | null; reviewed: boolean };

const groceries = { id: "c1" };
const rent = { id: "c2" };
const rows: Row[] = [
  { id: "a", category: null, reviewed: false },
  { id: "b", category: groceries, reviewed: true },
];

describe("patchById", () => {
  it("changes only the patched rows", () => {
    const next = patchById(rows, new Map([["a", { category: rent }]]));
    expect(next[0]).toEqual({ id: "a", category: rent, reviewed: false });
    expect(next[1]).toBe(rows[1]);
  });
});

describe("snapshotFields + revertPatches", () => {
  it("puts back exactly what was there", () => {
    const before = snapshotFields(rows, ["a", "b"], ["category"] as const);
    const applied = new Map([
      ["a", { category: rent }],
      ["b", { category: rent }],
    ]);
    const optimistic = patchById(rows, applied);
    expect(revertPatches(optimistic, applied, before)).toEqual(rows);
  });

  it("keeps a newer change made to the row since", () => {
    const before = snapshotFields(rows, ["a"], ["category"] as const);
    const applied = new Map([["a", { category: rent }]]);
    const newer = patchById(patchById(rows, applied), new Map([["a", { category: groceries }]]));
    expect(revertPatches(newer, applied, before)[0].category).toBe(groceries);
  });
});

describe("createSerialQueue", () => {
  it("runs calls in the order they were queued, even when the first is slower", async () => {
    const enqueue = createSerialQueue();
    const order: string[] = [];
    const slow = enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("save");
    });
    const undo = enqueue(async () => {
      order.push("undo");
    });
    await Promise.all([slow, undo]);
    expect(order).toEqual(["save", "undo"]);
  });

  it("keeps going after a failure", async () => {
    const enqueue = createSerialQueue();
    const failed = enqueue(async () => {
      throw new Error("offline");
    });
    await expect(failed).rejects.toThrow("offline");
    await expect(enqueue(async () => "next")).resolves.toBe("next");
  });
});
