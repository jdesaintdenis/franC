import { describe, expect, it } from "vitest";

import { shouldNotify } from "./notify";

const base = { reminderOn: true, subscriptionCount: 1, staleCount: 1, lastNotifiedOn: null, today: "2026-09-30" };

describe("shouldNotify", () => {
  it("notifies when stale and never notified", () => {
    expect(shouldNotify(base)).toBe(true);
  });

  it("waits 7 days between notifications", () => {
    expect(shouldNotify({ ...base, lastNotifiedOn: "2026-09-24" })).toBe(false);
    expect(shouldNotify({ ...base, lastNotifiedOn: "2026-09-23" })).toBe(true);
  });

  it("does nothing when the reminder is off, nothing is stale, or no device subscribed", () => {
    expect(shouldNotify({ ...base, reminderOn: false })).toBe(false);
    expect(shouldNotify({ ...base, staleCount: 0 })).toBe(false);
    expect(shouldNotify({ ...base, subscriptionCount: 0 })).toBe(false);
  });
});
