import { describe, expect, it } from "vitest";

import { groupByImport } from "./group";

function item(id: string, importId: string) {
  return {
    id,
    import: { id: importId, filename: `${importId}.csv`, kind: "csv" as const, uploadedAt: "2026-01-01T00:00:00.000Z", accountName: "Main" },
  };
}

describe("groupByImport", () => {
  it("returns no groups for an empty queue", () => {
    expect(groupByImport([])).toEqual([]);
  });

  it("groups consecutive items of one import and keeps their order", () => {
    const groups = groupByImport([item("a", "i1"), item("b", "i1"), item("c", "i2")]);
    expect(groups.map((g) => [g.importId, g.items.map((i) => i.id)])).toEqual([
      ["i1", ["a", "b"]],
      ["i2", ["c"]],
    ]);
  });

  it("carries the import's file name, account and upload time", () => {
    const [group] = groupByImport([item("a", "i1")]);
    expect(group).toMatchObject({ filename: "i1.csv", accountName: "Main", uploadedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("starts a new group when an import reappears after another", () => {
    const groups = groupByImport([item("a", "i1"), item("b", "i2"), item("c", "i1")]);
    expect(groups.map((g) => g.importId)).toEqual(["i1", "i2", "i1"]);
  });
});
