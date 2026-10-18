import { describe, expect, it } from "vitest";

import { rekeyItems, type RekeyItem } from "./rekey";

function item(overrides: Partial<RekeyItem> & Pick<RekeyItem, "id" | "merchantKey">): RekeyItem {
  return {
    accountId: "acc",
    sign: "out",
    status: "detected",
    lastSeenDate: "2025-09-11",
    ...overrides,
  };
}

/** Builds the group lookup and per-transaction keys from "txId -> current key". */
function world(txKeys: Record<string, string>, links: Record<string, string[]>) {
  const keys = new Set(Object.values(txKeys));
  return {
    currentKeyOfTx: new Map(Object.entries(txKeys)),
    linkedTxIds: new Map(Object.entries(links)),
    hasGroup: (_account: string, key: string) => keys.has(key),
  };
}

describe("rekeyItems", () => {
  it("leaves an item whose key still has a group", () => {
    const w = world({ t1: "INTERMARCHE", t2: "INTERMARCHE" }, { a: ["t1", "t2"] });
    expect(rekeyItems({ items: [item({ id: "a", merchantKey: "INTERMARCHE" })], ...w })).toEqual({
      rekeys: [],
      deletes: [],
    });
  });

  it("follows its transactions when a name is added", () => {
    const w = world({ t1: "merchant:m1", t2: "merchant:m1", t3: "merchant:m1" }, { a: ["t1", "t2", "t3"] });
    const result = rekeyItems({ items: [item({ id: "a", merchantKey: "INTERMARCHE", status: "confirmed" })], ...w });
    expect(result).toEqual({ rekeys: [{ id: "a", merchantKey: "merchant:m1" }], deletes: [] });
  });

  it("follows its transactions when a name is removed", () => {
    const w = world({ t1: "ORANGE BOX", t2: "ORANGE BOX" }, { a: ["t1", "t2"] });
    const result = rekeyItems({ items: [item({ id: "a", merchantKey: "merchant:m1" })], ...w });
    expect(result.rekeys).toEqual([{ id: "a", merchantKey: "ORANGE BOX" }]);
  });

  it("picks the group most of its transactions belong to, the smaller key on a tie", () => {
    const majority = world({ t1: "B", t2: "B", t3: "A" }, { a: ["t1", "t2", "t3"] });
    expect(rekeyItems({ items: [item({ id: "a", merchantKey: "OLD" })], ...majority }).rekeys[0].merchantKey).toBe("B");
    const tie = world({ t1: "B", t2: "A" }, { a: ["t1", "t2"] });
    expect(rekeyItems({ items: [item({ id: "a", merchantKey: "OLD" })], ...tie }).rekeys[0].merchantKey).toBe("A");
  });

  it("does nothing for an item without linked transactions", () => {
    const w = world({ t1: "X" }, {});
    expect(rekeyItems({ items: [item({ id: "a", merchantKey: "OLD" })], ...w })).toEqual({ rekeys: [], deletes: [] });
  });

  it("merges two items into one key and keeps the confirmed one", () => {
    const w = world(
      { t1: "merchant:m1", t2: "merchant:m1", t3: "merchant:m1", t4: "merchant:m1" },
      { a: ["t1", "t2"], b: ["t3", "t4"] },
    );
    const items = [
      item({ id: "a", merchantKey: "INTERMARCHE", status: "detected", lastSeenDate: "2025-09-11" }),
      item({ id: "b", merchantKey: "INTERMAR CENTRE", status: "confirmed", lastSeenDate: "2025-08-01" }),
    ];
    const result = rekeyItems({ items, ...w });
    expect(result.deletes).toEqual(["a"]);
    expect(result.rekeys).toEqual([{ id: "b", merchantKey: "merchant:m1" }]);
  });

  it("between equal statuses keeps the latest charge, then the smaller id", () => {
    const w = world({ t1: "M", t2: "M" }, { a: ["t1"], b: ["t2"] });
    const later = rekeyItems({
      items: [
        item({ id: "a", merchantKey: "X", lastSeenDate: "2025-08-01" }),
        item({ id: "b", merchantKey: "Y", lastSeenDate: "2025-09-01" }),
      ],
      ...w,
    });
    expect(later.deletes).toEqual(["a"]);
    const tie = rekeyItems({ items: [item({ id: "b", merchantKey: "Y" }), item({ id: "a", merchantKey: "X" })], ...w });
    expect(tie.deletes).toEqual(["b"]);
  });

  it("lets a mover be deleted by a stayer that already owns the key", () => {
    const w = world({ t1: "M", t2: "M" }, { a: ["t1"], b: ["t2"] });
    const result = rekeyItems({
      items: [
        item({ id: "a", merchantKey: "M", status: "confirmed" }),
        item({ id: "b", merchantKey: "OLD", status: "detected" }),
      ],
      ...w,
    });
    expect(result).toEqual({ rekeys: [], deletes: ["b"] });
  });

  it("never moves a dismissed item and skips moves onto a dismissed key", () => {
    const w = world({ t1: "M", t2: "M" }, { d: ["t1"], a: ["t2"] });
    const result = rekeyItems({
      items: [
        item({ id: "d", merchantKey: "OLD-D", status: "dismissed" }),
        item({ id: "a", merchantKey: "M", status: "dismissed" }),
        item({ id: "c", merchantKey: "OLD-C", status: "confirmed" }),
      ],
      ...{ ...w, linkedTxIds: new Map([["c", ["t2"]]]) },
    });
    expect(result).toEqual({ rekeys: [], deletes: [] });
  });
});
