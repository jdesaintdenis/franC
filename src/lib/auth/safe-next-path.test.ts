import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it("accepts a relative path", () => {
    expect(safeNextPath("/transactions")).toBe("/transactions");
    expect(safeNextPath("/transactions?foo=bar")).toBe("/transactions?foo=bar");
  });

  it("falls back to / when missing", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  it("rejects protocol-relative paths", () => {
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
  });

  it("rejects absolute URLs", () => {
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("http://evil.com/x")).toBe("/");
  });

  it("rejects paths not starting with /", () => {
    expect(safeNextPath("transactions")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
  });
});
