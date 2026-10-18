import { describe, expect, it } from "vitest";

import { activeHeaderIndex, dayHeaderIndexes, toListEntries } from "./day-groups";

const rows = [
  { id: "c", date: "2026-09-28" },
  { id: "b", date: "2026-09-28" },
  { id: "a", date: "2026-09-26" },
];

describe("toListEntries", () => {
  it("is empty for no rows", () => {
    expect(toListEntries([])).toEqual([]);
  });

  it("puts one header before the first row of each date, keeping order", () => {
    expect(toListEntries(rows)).toEqual([
      { kind: "day", date: "2026-09-28" },
      { kind: "row", item: rows[0], first: true, last: false },
      { kind: "row", item: rows[1], first: false, last: true },
      { kind: "day", date: "2026-09-26" },
      { kind: "row", item: rows[2], first: true, last: true },
    ]);
  });
});

describe("dayHeaderIndexes / activeHeaderIndex", () => {
  const indexes = dayHeaderIndexes(toListEntries(rows));

  it("finds the header positions", () => {
    expect(indexes).toEqual([0, 3]);
  });

  it("picks the last header at or before the first visible entry", () => {
    expect(activeHeaderIndex(indexes, 0)).toBe(0);
    expect(activeHeaderIndex(indexes, 2)).toBe(0);
    expect(activeHeaderIndex(indexes, 3)).toBe(3);
    expect(activeHeaderIndex(indexes, 4)).toBe(3);
  });

  it("returns -1 when no header precedes", () => {
    expect(activeHeaderIndex([], 5)).toBe(-1);
    expect(activeHeaderIndex([2], 1)).toBe(-1);
  });
});
