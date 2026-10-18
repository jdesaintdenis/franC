import { describe, expect, it } from "vitest";

import { matchIncoming, type Existing, type Incoming } from "./match";

let n = 0;
const inc = (over: Partial<Incoming> = {}): Incoming => {
  n += 1;
  return { date: "2026-09-29", amountCents: -588, dedupeHash: `in-${n}`, occurrenceIndex: 0, externalId: null, ...over };
};
const ex = (id: string, over: Partial<Existing> = {}): Existing => ({
  id,
  date: "2026-09-29",
  amountCents: -588,
  source: "csv",
  externalId: null,
  dedupeHash: `ex-${id}`,
  occurrenceIndex: 0,
  matched: [],
  awaitingBank: false,
  ...over,
});
const waiting = (id: string, over: Partial<Existing> = {}): Existing =>
  ex(id, { source: "manual", awaitingBank: true, dedupeHash: `manual:${id}`, ...over });

describe("matchIncoming exact passes", () => {
  it("matches the bank id of a row", () => {
    const [d] = matchIncoming("sync", [inc({ externalId: "E1", amountCents: 1 })], [ex("a", { source: "sync", externalId: "E1" })]);
    expect(d).toEqual({ kind: "duplicate", targetId: "a", link: false });
  });

  it("matches hash and occurrence, but not another occurrence", () => {
    const rows = [inc({ dedupeHash: "h" }), inc({ dedupeHash: "h", occurrenceIndex: 1 })];
    const existing = [ex("a", { dedupeHash: "h", amountCents: 7 })];
    expect(matchIncoming("csv", rows, existing)).toEqual([{ kind: "duplicate", targetId: "a", link: false }, { kind: "insert" }]);
  });

  it("matches an identity merged into a row (alias), by id and by hash", () => {
    const existing = [
      ex("a", {
        matched: [{ source: "sync", dedupeHash: "sh", occurrenceIndex: 0, externalId: "E9" }],
      }),
    ];
    const rows = [inc({ externalId: "E9" }), inc({ dedupeHash: "sh" })];
    expect(matchIncoming("sync", rows, existing)).toEqual([
      { kind: "duplicate", targetId: "a", link: false },
      { kind: "duplicate", targetId: "a", link: false },
    ]);
  });

  it("an exact hash match with a row of the other side asks to record the link, once", () => {
    const csvRow = ex("a", { dedupeHash: "h" });
    expect(matchIncoming("sync", [inc({ dedupeHash: "h", externalId: "E1" })], [csvRow])).toEqual([
      { kind: "duplicate", targetId: "a", link: true },
    ]);
    const linked = ex("a", { dedupeHash: "h", matched: [{ source: "sync", dedupeHash: "x", occurrenceIndex: 0, externalId: "E1" }] });
    expect(matchIncoming("sync", [inc({ externalId: "E1" })], [linked])).toEqual([{ kind: "duplicate", targetId: "a", link: false }]);
  });

  it("a row that is an exact target is not a fuzzy candidate for another incoming row", () => {
    const existing = [ex("a", { dedupeHash: "h" })];
    const rows = [inc({ dedupeHash: "h", date: "2026-09-30" }), inc({ date: "2026-09-30" })];
    expect(matchIncoming("sync", rows, existing)).toEqual([{ kind: "duplicate", targetId: "a", link: true }, { kind: "insert" }]);
  });
});

describe("matchIncoming fuzzy pass", () => {
  it("merges with the single same-amount row of the other side", () => {
    expect(matchIncoming("sync", [inc({ date: "2026-09-30" })], [ex("a")])).toEqual([{ kind: "merge", targetId: "a" }]);
  });

  it("works in both directions", () => {
    expect(matchIncoming("csv", [inc()], [ex("a", { source: "sync", externalId: "E1" })])).toEqual([{ kind: "merge", targetId: "a" }]);
  });

  it("never matches the same side or another amount", () => {
    expect(matchIncoming("csv", [inc()], [ex("a")])).toEqual([{ kind: "insert" }]);
    expect(matchIncoming("sync", [inc()], [ex("a", { source: "sync", externalId: "E1" })])).toEqual([{ kind: "insert" }]);
    expect(matchIncoming("sync", [inc()], [ex("a", { amountCents: -589 })])).toEqual([{ kind: "insert" }]);
  });

  it("includes 3 days apart and excludes 4, either way", () => {
    const at = (date: string) => matchIncoming("sync", [inc({ date })], [ex("a", { date: "2026-09-29" })])[0].kind;
    expect(at("2026-10-02")).toBe("merge");
    expect(at("2026-09-26")).toBe("merge");
    expect(at("2026-10-03")).toBe("insert");
    expect(at("2026-09-25")).toBe("insert");
  });

  it("counts days across month and year boundaries", () => {
    const row = [inc({ date: "2027-01-01" })];
    expect(matchIncoming("sync", row, [ex("a", { date: "2026-12-29" })])[0].kind).toBe("merge");
    expect(matchIncoming("sync", row, [ex("a", { date: "2026-12-28" })])[0].kind).toBe("insert");
    const leap = [inc({ date: "2028-03-02" })];
    expect(matchIncoming("sync", leap, [ex("a", { date: "2028-02-28" })])[0].kind).toBe("merge");
  });

  it("with several candidates and none on the same date, the row is a possible duplicate", () => {
    const existing = [ex("a", { date: "2026-09-28" }), ex("b", { date: "2026-09-30" })];
    expect(matchIncoming("sync", [inc()], existing)).toEqual([{ kind: "possible", candidateIds: ["a", "b"] }]);
  });

  it("with several candidates, the single one on the same date wins", () => {
    const existing = [ex("a", { date: "2026-09-28" }), ex("b"), ex("c", { date: "2026-09-30" })];
    expect(matchIncoming("sync", [inc()], existing)).toEqual([{ kind: "merge", targetId: "b" }]);
  });

  it("with two on the same date, the row is possible", () => {
    expect(matchIncoming("sync", [inc()], [ex("a"), ex("b")])).toEqual([{ kind: "possible", candidateIds: ["a", "b"] }]);
  });

  it("each candidate absorbs one row: two existing absorb two incoming, the third is inserted", () => {
    const existing = [ex("a", { date: "2026-09-29" }), ex("b", { date: "2026-09-30" })];
    const rows = [inc({ date: "2026-09-30" }), inc({ date: "2026-09-29" }), inc({ date: "2026-09-29" })];
    // Processed by date: 29 -> a (same day), 29 -> b (the only one left), 30 -> nothing left.
    expect(matchIncoming("sync", rows, existing)).toEqual([
      { kind: "insert" },
      { kind: "merge", targetId: "a" },
      { kind: "merge", targetId: "b" },
    ]);
  });

  it("possible rows do not consume their candidates", () => {
    const existing = [ex("a", { date: "2026-09-28" }), ex("b", { date: "2026-09-30" })];
    const rows = [inc(), inc()];
    expect(matchIncoming("sync", rows, existing)).toEqual([
      { kind: "possible", candidateIds: ["a", "b"] },
      { kind: "possible", candidateIds: ["a", "b"] },
    ]);
  });

  it("an earlier row takes the candidate first, whatever the input order", () => {
    const existing = [ex("a", { date: "2026-09-30" })];
    const late = inc({ date: "2026-09-30" });
    const early = inc({ date: "2026-09-29" });
    // Processed by date, so the earlier row wins the only candidate; the other is inserted.
    expect(matchIncoming("sync", [late, early], existing)).toEqual([{ kind: "insert" }, { kind: "merge", targetId: "a" }]);
  });

  it("a row already linked to the incoming side is not a candidate", () => {
    const linkedRow = ex("a", { matched: [{ source: "sync", dedupeHash: "x", occurrenceIndex: 0, externalId: "E0" }] });
    expect(matchIncoming("sync", [inc()], [linkedRow])).toEqual([{ kind: "insert" }]);
    const synced = ex("b", { source: "sync", externalId: "E1", matched: [{ source: "csv", dedupeHash: "x", occurrenceIndex: 0, externalId: null }] });
    expect(matchIncoming("csv", [inc()], [synced])).toEqual([{ kind: "insert" }]);
  });

  it("treats a csv row with a bank id as already bank-linked", () => {
    expect(matchIncoming("sync", [inc()], [ex("a", { externalId: "E1" })])).toEqual([{ kind: "insert" }]);
  });

  it("is deterministic and keeps result order aligned with the input", () => {
    const existing = [ex("a", { date: "2026-09-28" }), ex("b", { date: "2026-09-30" })];
    const rows = [inc({ date: "2026-09-30" }), inc({ date: "2026-09-28" })];
    const first = matchIncoming("sync", rows, existing);
    expect(matchIncoming("sync", rows, existing)).toEqual(first);
    expect(first).toEqual([{ kind: "merge", targetId: "b" }, { kind: "merge", targetId: "a" }]);
  });

  it("ignored rows are ordinary candidates (the caller passes them like any other)", () => {
    // Nothing in Existing marks "ignored": an ignored duplicate absorbs the incoming row and stays ignored.
    expect(matchIncoming("sync", [inc()], [ex("ignored")])).toEqual([{ kind: "merge", targetId: "ignored" }]);
  });
});

describe("matchIncoming rows added by hand", () => {
  it("adopts a waiting row with the same amount within 3 days", () => {
    const [d] = matchIncoming("sync", [inc({ date: "2026-10-01" })], [waiting("w")]);
    expect(d).toEqual({ kind: "adopt", targetId: "w" });
  });

  it("works for a CSV row too", () => {
    expect(matchIncoming("csv", [inc()], [waiting("w")])).toEqual([{ kind: "adopt", targetId: "w" }]);
  });

  it("never beats a row of the other side", () => {
    const [d] = matchIncoming("sync", [inc()], [waiting("w"), ex("c")]);
    expect(d).toEqual({ kind: "merge", targetId: "c" });
  });

  it("inserts when the amount or the window differs", () => {
    expect(matchIncoming("sync", [inc({ amountCents: -600 })], [waiting("w")])).toEqual([{ kind: "insert" }]);
    expect(matchIncoming("sync", [inc({ date: "2026-10-05" })], [waiting("w")])).toEqual([{ kind: "insert" }]);
  });

  it("with two waiting rows, takes the one on the same date, else inserts", () => {
    const two = [waiting("a", { date: "2026-09-27" }), waiting("b", { date: "2026-09-29" })];
    expect(matchIncoming("sync", [inc({ date: "2026-09-29" })], two)).toEqual([{ kind: "adopt", targetId: "b" }]);
    const far = [waiting("a", { date: "2026-09-27" }), waiting("b", { date: "2026-10-01" })];
    expect(matchIncoming("sync", [inc({ date: "2026-09-29" })], far)).toEqual([{ kind: "insert" }]);
  });

  it("ignores a manual row that no longer waits", () => {
    expect(matchIncoming("sync", [inc()], [waiting("w", { awaitingBank: false })])).toEqual([{ kind: "insert" }]);
  });

  it("one waiting row absorbs only one of two incoming rows", () => {
    expect(matchIncoming("sync", [inc(), inc()], [waiting("w")])).toEqual([
      { kind: "adopt", targetId: "w" },
      { kind: "insert" },
    ]);
  });

  it("an exact duplicate still wins, and its target is not adopted twice", () => {
    const existing = [ex("a", { source: "sync", dedupeHash: "h", amountCents: -1 }), waiting("w")];
    expect(matchIncoming("csv", [inc({ dedupeHash: "h", amountCents: -1 }), inc()], existing)).toEqual([
      { kind: "duplicate", targetId: "a", link: true },
      { kind: "adopt", targetId: "w" },
    ]);
  });
});
