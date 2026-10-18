import { describe, expect, it } from "vitest";

import { syncLine } from "./sync-line";

const early = new Date("2026-10-04T07:00:00Z");
const late = new Date("2026-10-05T07:00:00Z");

describe("syncLine", () => {
  it("is null without connections", () => {
    expect(syncLine([])).toBeNull();
  });

  it("uses the oldest sync", () => {
    expect(syncLine([{ kind: "ok", syncedAt: late }, { kind: "ok", syncedAt: early }])).toEqual({ kind: "synced", at: early });
  });

  it("says never while one connection was never synced", () => {
    expect(syncLine([{ kind: "ok", syncedAt: late }, { kind: "never" }])).toEqual({ kind: "never" });
  });

  it("puts reconnect before failing before the rate limit", () => {
    const failing = { kind: "failing", since: late } as const;
    expect(syncLine([failing, { kind: "rateLimited" }, { kind: "reconnect", expiresOn: "2026-10-10", expired: false, reason: "expiring" }])).toEqual({ kind: "reconnect" });
    expect(syncLine([{ kind: "rateLimited" }, failing, { kind: "failing", since: early }])).toEqual({ kind: "failing", since: early });
    expect(syncLine([{ kind: "ok", syncedAt: late }, { kind: "rateLimited" }])).toEqual({ kind: "rateLimited" });
  });
});
