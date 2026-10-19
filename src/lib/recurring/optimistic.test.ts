import { describe, expect, it } from "vitest";

import { applyStatusChange, applyStatusChanges, resolvePriceAlert, setKeepsForNextMonth } from "./optimistic";

const items = [
  { id: "a", status: "detected" as const },
  { id: "b", status: "confirmed" as const },
];

describe("applyStatusChange", () => {
  it("moves a detected item to confirmed without touching others or mutating", () => {
    const next = applyStatusChange(items, { id: "a", status: "confirmed" });
    expect(next).toEqual([
      { id: "a", status: "confirmed" },
      { id: "b", status: "confirmed" },
    ]);
    expect(items[0].status).toBe("detected");
  });

  it("marks a dismissed item in place", () => {
    expect(applyStatusChange(items, { id: "a", status: "dismissed" })).toEqual([
      { id: "a", status: "dismissed" },
      items[1],
    ]);
  });

  it("restores a dismissed item as detected or confirmed", () => {
    const dismissed = [{ id: "a", status: "dismissed" as const }];
    expect(applyStatusChange(dismissed, { id: "a", status: "confirmed" })[0].status).toBe("confirmed");
    expect(applyStatusChange(dismissed, { id: "a", status: "detected" })[0].status).toBe("detected");
  });

  it("moves a confirmed item back to detected", () => {
    expect(applyStatusChange(items, { id: "b", status: "detected" })[1].status).toBe("detected");
  });

  it("ignores unknown ids", () => {
    expect(applyStatusChange(items, { id: "zzz", status: "confirmed" })).toEqual(items);
  });
});

describe("applyStatusChange with ended items", () => {
  const flagged = [
    { id: "a", status: "confirmed" as const, possiblyCancelled: true },
    { id: "b", status: "ended" as const, possiblyCancelled: false },
  ];

  it("marks an item ended in place and clears its flag", () => {
    expect(applyStatusChange(flagged, { id: "a", status: "ended" })[0]).toEqual({
      id: "a",
      status: "ended",
      possiblyCancelled: false,
    });
  });

  it("resumes an ended item as confirmed", () => {
    expect(applyStatusChange(flagged, { id: "b", status: "confirmed" })[1].status).toBe("confirmed");
  });

  it("still active clears the flag and keeps the status", () => {
    expect(applyStatusChange(flagged, { id: "a", status: "stillActive" })[0]).toEqual({
      id: "a",
      status: "confirmed",
      possiblyCancelled: false,
    });
  });
});

describe("applyStatusChanges", () => {
  it("applies several changes at once without mutating", () => {
    const next = applyStatusChanges(items, [
      { id: "a", status: "confirmed" },
      { id: "b", status: "dismissed" },
    ]);
    expect(next.map((i) => i.status)).toEqual(["confirmed", "dismissed"]);
    expect(items[0].status).toBe("detected");
  });

  it("ignores unknown ids and an empty list", () => {
    expect(applyStatusChanges(items, [{ id: "zzz", status: "ended" }])).toEqual(items);
    expect(applyStatusChanges(items, [])).toEqual(items);
  });
});

describe("resolvePriceAlert", () => {
  const list = [
    { id: "a", hasPriceAlert: true, typicalAmountCents: -3999, alert: { newAmountCents: -4499 } },
    { id: "b", hasPriceAlert: true, typicalAmountCents: -500, alert: { newAmountCents: -600 } },
  ];

  it("accepting adopts the new amount for that item only", () => {
    const next = resolvePriceAlert(list, "a", true);
    expect(next[0]).toEqual({ id: "a", hasPriceAlert: false, typicalAmountCents: -4499, alert: null });
    expect(next[1]).toBe(list[1]);
  });

  it("keeping the old price only clears the alert", () => {
    expect(resolvePriceAlert(list, "a", false)[0]).toEqual({
      id: "a",
      hasPriceAlert: false,
      typicalAmountCents: -3999,
      alert: null,
    });
  });
});

describe("setKeepsForNextMonth", () => {
  const list = [
    { id: "a", keepsForNextMonth: false },
    { id: "b", keepsForNextMonth: false },
  ];

  it("flips that item only", () => {
    const next = setKeepsForNextMonth(list, "a", true);
    expect(next).toEqual([
      { id: "a", keepsForNextMonth: true },
      { id: "b", keepsForNextMonth: false },
    ]);
    expect(next[1]).toBe(list[1]);
  });
});
