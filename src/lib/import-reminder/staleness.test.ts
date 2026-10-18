import { describe, expect, it } from "vitest";

import { dataUpTo, findStaleAccounts, freshDate, laggingAccounts, type AccountFreshness } from "./staleness";

function account(overrides: Partial<AccountFreshness> & { accountId: string }): AccountFreshness {
  return { name: overrides.accountId, latestDate: null, lastImportDate: null, reminder: true, ...overrides };
}

describe("freshDate", () => {
  it("takes the later of the latest transaction and the latest import", () => {
    expect(freshDate({ latestDate: "2026-09-10", lastImportDate: "2026-09-28" })).toBe("2026-09-28");
    expect(freshDate({ latestDate: "2026-09-29", lastImportDate: "2026-09-28" })).toBe("2026-09-29");
    expect(freshDate({ latestDate: "2026-09-10", lastImportDate: null })).toBe("2026-09-10");
    expect(freshDate({ latestDate: null, lastImportDate: "2026-09-01" })).toBe("2026-09-01");
    expect(freshDate({ latestDate: null, lastImportDate: null })).toBeNull();
  });
});

describe("findStaleAccounts", () => {
  const today = "2026-09-30";

  it("is not stale exactly at the threshold, stale one day over", () => {
    const accounts = [
      account({ accountId: "at", latestDate: "2026-09-16" }),
      account({ accountId: "over", latestDate: "2026-09-15" }),
    ];
    expect(findStaleAccounts({ accounts, days: 14, today })).toEqual([
      { accountId: "over", name: "over", latestDate: "2026-09-15", freshDate: "2026-09-15", ageDays: 15 },
    ]);
  });

  it("counts an import newer than the latest transaction as fresh", () => {
    const accounts = [account({ accountId: "a", latestDate: "2026-08-01", lastImportDate: "2026-09-25" })];
    expect(findStaleAccounts({ accounts, days: 14, today })).toEqual([]);
  });

  it("skips accounts never imported", () => {
    expect(findStaleAccounts({ accounts: [account({ accountId: "a" })], days: 14, today })).toEqual([]);
  });

  it("skips accounts with the reminder off, and everything when the reminder is off", () => {
    const old = { latestDate: "2026-01-01" };
    expect(findStaleAccounts({ accounts: [account({ accountId: "a", reminder: false, ...old })], days: 14, today })).toEqual([]);
    expect(findStaleAccounts({ accounts: [account({ accountId: "a", ...old })], days: null, today })).toEqual([]);
  });

  it("sorts oldest first, then by name", () => {
    const accounts = [
      account({ accountId: "b", name: "Beta", latestDate: "2026-09-01" }),
      account({ accountId: "c", name: "Alpha", latestDate: "2026-09-01" }),
      account({ accountId: "d", name: "Delta", latestDate: "2026-07-01" }),
    ];
    expect(findStaleAccounts({ accounts, days: 14, today }).map((a) => a.accountId)).toEqual(["d", "c", "b"]);
  });

  it("counts days across month and year boundaries", () => {
    const accounts = [account({ accountId: "a", latestDate: "2025-12-20" })];
    expect(findStaleAccounts({ accounts, days: 14, today: "2026-01-03" })).toEqual([]);
    expect(findStaleAccounts({ accounts, days: 14, today: "2026-01-05" })[0]?.ageDays).toBe(16);
    expect(findStaleAccounts({ accounts: [account({ accountId: "a", latestDate: "2026-02-14" })], days: 14, today: "2026-03-01" })[0]?.ageDays).toBe(15);
  });
});

describe("dataUpTo and laggingAccounts", () => {
  const accounts = [
    account({ accountId: "main", latestDate: "2026-09-28" }),
    account({ accountId: "savings", latestDate: "2026-08-02" }),
    account({ accountId: "joint", latestDate: "2026-09-10" }),
    account({ accountId: "empty" }),
  ];

  it("returns the newest transaction date", () => {
    expect(dataUpTo(accounts)).toBe("2026-09-28");
    expect(dataUpTo([account({ accountId: "empty" })])).toBeNull();
  });

  it("lists accounts behind the newest, oldest first", () => {
    expect(laggingAccounts(accounts).map((a) => a.accountId)).toEqual(["savings", "joint"]);
    expect(laggingAccounts([account({ accountId: "a", latestDate: "2026-09-28" })])).toEqual([]);
  });
});
