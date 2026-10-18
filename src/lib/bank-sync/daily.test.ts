import { describe, expect, it, vi } from "vitest";

import { runDailySync } from "./daily";
import type { SyncResult } from "./sync";

const NOW = new Date("2026-10-05T07:00:00Z");
const ok = (inserted: number): SyncResult => ({ ok: true, importId: "i", inserted, duplicate: 0, possible: 0, errors: 0 });

function run(targets: Array<{ userId: string; email: string; linkId: string }>, results: Record<string, SyncResult | Error>) {
  const sync = vi.fn(async (_u: string, linkId: string) => {
    const r = results[linkId] ?? ok(0);
    if (r instanceof Error) throw r;
    return r;
  });
  const recordAttempt = vi.fn(async () => {});
  const refreshDerivedData = vi.fn(async () => {});
  const promise = runDailySync({
    targets,
    isAllowed: (email) => email !== "blocked@x.test",
    sync,
    recordAttempt,
    refreshDerivedData,
    now: () => NOW,
  });
  return { promise, sync, recordAttempt, refreshDerivedData };
}

const t = (userId: string, linkId: string, email = `${userId}@x.test`) => ({ userId, email, linkId });

describe("runDailySync", () => {
  it("syncs allowed users' links in order and records each attempt", async () => {
    const r = run([t("u1", "a"), t("blocked", "b", "blocked@x.test"), t("u1", "c")], { a: ok(2), c: ok(0) });
    expect(await r.promise).toEqual({ links: 2, synced: 2, inserted: 2, failed: 0, rateLimited: 0 });
    expect(r.sync.mock.calls).toEqual([["u1", "a"], ["u1", "c"]]);
    expect(r.recordAttempt).toHaveBeenCalledWith("u1", "a", { at: NOW, error: null });
    expect(r.recordAttempt).toHaveBeenCalledTimes(2);
  });

  it("refreshes derived data once per user that got rows", async () => {
    const r = run([t("u1", "a"), t("u1", "b"), t("u2", "c")], { a: ok(1), b: ok(3), c: ok(0) });
    await r.promise;
    expect(r.refreshDerivedData.mock.calls).toEqual([["u1"]]);
  });

  it("records failures and rate limits with their code and keeps going", async () => {
    const r = run([t("u1", "a"), t("u1", "b"), t("u1", "c")], {
      a: { ok: false, error: "bank_unavailable" },
      b: { ok: false, error: "rate_limited" },
      c: ok(1),
    });
    expect(await r.promise).toEqual({ links: 3, synced: 1, inserted: 1, failed: 1, rateLimited: 1 });
    expect(r.recordAttempt).toHaveBeenCalledWith("u1", "a", { at: NOW, error: "bank_unavailable" });
    expect(r.recordAttempt).toHaveBeenCalledWith("u1", "b", { at: NOW, error: "rate_limited" });
  });

  it("treats a throw as a failed attempt for that link only", async () => {
    const r = run([t("u1", "a"), t("u1", "b")], { a: new Error("boom") });
    expect((await r.promise).failed).toBe(1);
    expect(r.recordAttempt).toHaveBeenCalledWith("u1", "a", { at: NOW, error: "network" });
    expect(r.sync).toHaveBeenCalledTimes(2);
  });
});
