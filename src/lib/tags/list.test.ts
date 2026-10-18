import { describe, expect, it } from "vitest";

import { distinctTags, findTagByName, mergeTagNames, withTag } from "./list";

describe("tag list helpers", () => {
  it("adds a tag in case-insensitive name order and ignores duplicates", () => {
    const tags = [
      { id: "1", name: "alpha" },
      { id: "3", name: "Zulu" },
    ];
    expect(withTag(tags, { id: "2", name: "Bravo" }).map((t) => t.id)).toEqual(["1", "2", "3"]);
    expect(withTag(tags, { id: "1", name: "alpha" })).toBe(tags);
  });

  it("lists distinct tags across rows", () => {
    const a = { id: "1", name: "b" };
    const b = { id: "2", name: "A" };
    expect(distinctTags([[a], [a, b]]).map((t) => t.id)).toEqual(["2", "1"]);
  });

  it("merges names case-insensitively", () => {
    expect(mergeTagNames(["Trip", "food"], ["trip", "Art"])).toEqual(["Art", "food", "Trip"]);
  });
});

describe("findTagByName", () => {
  const lists = [[{ id: "1", name: "Holiday" }], [{ id: "2", name: "Work" }]];

  it("finds a known tag ignoring case and surrounding spaces", () => {
    expect(findTagByName(lists, "  holiday ")?.id).toBe("1");
  });

  it("gives null for an unknown or empty name", () => {
    expect(findTagByName(lists, "Gift")).toBeNull();
    expect(findTagByName(lists, "  ")).toBeNull();
  });
});
