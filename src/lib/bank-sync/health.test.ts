import { describe, expect, it } from "vitest";

import { connectionHealth, syncDue, type HealthLink } from "./health";

const NOW = new Date("2026-10-05T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const link = (o: Partial<HealthLink> = {}): HealthLink => ({
  imported: true,
  lastSyncedAt: new Date("2026-10-05T07:00:00Z"),
  lastError: null,
  failingSince: null,
  ...o,
});
const health = (o: { status?: string; validUntil?: Date; links?: HealthLink[] }) =>
  connectionHealth({ status: "active", validUntil: day(100), links: [link()], now: NOW, ...o });

describe("connectionHealth", () => {
  it("is ok with the oldest sync of the imported links", () => {
    const old = new Date("2026-10-04T07:00:00Z");
    expect(health({ links: [link(), link({ lastSyncedAt: old }), link({ imported: false, lastSyncedAt: null })] })).toEqual({
      kind: "ok",
      syncedAt: old,
    });
  });

  it("is never without a sync or without imported links", () => {
    expect(health({ links: [link({ lastSyncedAt: null })] })).toEqual({ kind: "never" });
    expect(health({ links: [link({ imported: false })] })).toEqual({ kind: "never" });
  });

  it("asks to reconnect within 14 days, not before", () => {
    expect(health({ validUntil: day(14) })).toEqual({ kind: "reconnect", expiresOn: "2026-10-19", expired: false, reason: "expiring" });
    expect(health({ validUntil: day(15) }).kind).toBe("ok");
  });

  it("asks to reconnect once ended, or when the status says expired", () => {
    expect(health({ validUntil: day(-1) })).toMatchObject({ kind: "reconnect", expired: true, reason: "expired" });
    expect(health({ status: "expired" })).toMatchObject({ kind: "reconnect", expired: true });
  });

  it("asks to reconnect when the bank refuses the session", () => {
    expect(health({ links: [link({ lastError: "unauthorized" })] })).toMatchObject({ kind: "reconnect", expired: false, reason: "refused" });
  });

  it("is failing since the earliest failure, but reconnect wins", () => {
    const early = new Date("2026-10-03T07:00:00Z");
    const late = new Date("2026-10-04T07:00:00Z");
    const links = [link({ failingSince: late, lastError: "network" }), link({ failingSince: early, lastError: "network" })];
    expect(health({ links })).toEqual({ kind: "failing", since: early });
    expect(health({ links, validUntil: day(3) }).kind).toBe("reconnect");
  });

  it("reports the rate limit without calling it failing", () => {
    expect(health({ links: [link({ lastError: "rate_limited" })] })).toEqual({ kind: "rateLimited" });
  });
});

describe("syncDue", () => {
  const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000);
  it("is due for a never-synced or older-than-2h imported link", () => {
    expect(syncDue([link({ lastSyncedAt: null })], NOW)).toBe(true);
    expect(syncDue([link({ lastSyncedAt: at(121) })], NOW)).toBe(true);
  });
  it("is not due within 2 hours, or without imported links", () => {
    expect(syncDue([link({ lastSyncedAt: at(120) })], NOW)).toBe(false);
    expect(syncDue([link({ imported: false, lastSyncedAt: null })], NOW)).toBe(false);
    expect(syncDue([], NOW)).toBe(false);
  });
});
