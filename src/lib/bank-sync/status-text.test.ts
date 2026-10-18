import { describe, expect, it } from "vitest";

import { connectionStatusText } from "./status-text";

const t = (key: string, values?: Record<string, string | number | Date>) => `${key}|${JSON.stringify(values ?? {})}`;
const base = { today: "2026-10-08", now: new Date("2026-10-08T10:00:00Z"), locale: "en" as const, t };

describe("connectionStatusText", () => {
  it("says a refused session needs reconnecting, with no date", () => {
    expect(connectionStatusText({ ...base, health: { kind: "reconnect", expiresOn: "2026-11-01", expired: false, reason: "refused" } })).toBe(
      "status.reconnectRefused|{}",
    );
  });

  it("picks the expired or expiring wording and formats the date", () => {
    const expired = connectionStatusText({ ...base, health: { kind: "reconnect", expiresOn: "2026-10-01", expired: true, reason: "expired" } });
    const expiring = connectionStatusText({ ...base, health: { kind: "reconnect", expiresOn: "2026-10-15", expired: false, reason: "expiring" } });
    expect(expired.startsWith("status.reconnectExpired|")).toBe(true);
    expect(expiring.startsWith("status.reconnectExpiring|")).toBe(true);
  });

  it("covers failing, rate limited, synced and never", () => {
    expect(connectionStatusText({ ...base, health: { kind: "failing", since: new Date("2026-10-04T08:00:00Z") } }).startsWith("status.failing|")).toBe(true);
    expect(connectionStatusText({ ...base, health: { kind: "rateLimited" } })).toBe("sync.errors.rate_limited|{}");
    expect(connectionStatusText({ ...base, health: { kind: "ok", syncedAt: new Date("2026-10-08T07:02:00Z") } }).startsWith("status.synced|")).toBe(true);
    expect(connectionStatusText({ ...base, health: { kind: "never" } })).toBe("status.never|{}");
  });
});
