import { describe, expect, it } from "vitest";

import { merchantSnapshotSchema } from "./input";

const id = "7b5f3f0e-2f7b-4a3e-9a53-0f3f5a0d9c11";
const snapshot = {
  id,
  name: "Orange",
  createdAt: "2026-09-30T10:00:00.000Z",
  patterns: [{ id: "0d3c9a42-8c0e-4c1b-8a1d-2b1e7f9a6e55", matchType: "equals", pattern: "orange", createdAt: "2026-09-30T10:00:01.000Z" }],
};

describe("merchantSnapshotSchema", () => {
  it("accepts what deleteMerchant returns", () => {
    expect(merchantSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("rejects tampered values", () => {
    expect(merchantSnapshotSchema.safeParse({ ...snapshot, id: "x" }).success).toBe(false);
    expect(merchantSnapshotSchema.safeParse({ ...snapshot, name: "  " }).success).toBe(false);
    expect(merchantSnapshotSchema.safeParse({ ...snapshot, patterns: [{ ...snapshot.patterns[0], matchType: "regex" }] }).success).toBe(false);
    expect(merchantSnapshotSchema.safeParse({ ...snapshot, createdAt: "yesterday" }).success).toBe(false);
  });
});
