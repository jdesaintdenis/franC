import { describe, expect, it } from "vitest";

import { pickDefaultAccountId } from "./default";

const accounts = [{ id: "a" }, { id: "b" }];

describe("pickDefaultAccountId", () => {
  it("prefers the last used account", () => {
    expect(pickDefaultAccountId(accounts, "b")).toBe("b");
  });

  it("falls back to the first account without imports", () => {
    expect(pickDefaultAccountId(accounts, null)).toBe("a");
  });

  it("ignores an unknown last used id", () => {
    expect(pickDefaultAccountId(accounts, "gone")).toBe("a");
  });

  it("returns an empty string with no accounts", () => {
    expect(pickDefaultAccountId([], null)).toBe("");
  });
});
