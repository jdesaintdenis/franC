import { describe, expect, it } from "vitest";

import { compareQueueItems, mergeRestored, nextCurrentId } from "./queue";

const item = (id: string, date: string, importId = "i1", uploadedAt = "2025-02-01T10:00:00.000Z") => ({
  id,
  date,
  import: { id: importId, uploadedAt },
});

describe("compareQueueItems", () => {
  it("orders newest import first, then newest date, then id", () => {
    const rows = [
      item("a", "2025-01-01", "old", "2025-01-01T00:00:00.000Z"),
      item("b", "2025-01-02"),
      item("c", "2025-01-03"),
      item("d", "2025-01-03"),
    ];
    expect([...rows].sort(compareQueueItems).map((r) => r.id)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("mergeRestored", () => {
  it("puts restored rows back in queue order and skips duplicates", () => {
    const items = [item("c", "2025-01-03"), item("a", "2025-01-01")];
    const merged = mergeRestored(items, [item("b", "2025-01-02"), item("a", "2025-01-01")]);
    expect(merged.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("nextCurrentId", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("keeps the current row when it stays", () => {
    expect(nextCurrentId(rows, new Set(["a"]), "b")).toBe("b");
  });
  it("moves to the next remaining row", () => {
    expect(nextCurrentId(rows, new Set(["b"]), "b")).toBe("c");
    expect(nextCurrentId(rows, new Set(["b", "c"]), "b")).toBe("a");
  });
  it("falls back to the last row when the last one was removed", () => {
    expect(nextCurrentId(rows, new Set(["c"]), "c")).toBe("b");
  });
  it("returns null when nothing is left", () => {
    expect(nextCurrentId(rows, new Set(["a", "b", "c"]), "a")).toBeNull();
  });
  it("starts at the first row without a current one", () => {
    expect(nextCurrentId(rows, new Set(), null)).toBe("a");
  });
});
