import { describe, expect, it } from "vitest";

import type { AccountBalanceOverview, BalanceBreach } from "../balance/projection";
import type { StaleAccount } from "../import-reminder/staleness";
import { buildAttention, type AttentionInput } from "./attention";

const stale = (id: string): StaleAccount => ({ accountId: id, name: id, latestDate: null, freshDate: "2025-01-01", ageDays: 40 });

const balance = (id: string, breach: BalanceBreach | null): AccountBalanceOverview => ({
  accountId: id,
  name: id,
  balanceCents: 1000,
  asOf: "2025-09-01",
  thresholdCents: 500,
  series: [],
  lowest: { date: "2025-09-01", balanceCents: 1000 },
  breach,
  sinceLastImport: [],
});

const alert = (id: string) => ({ id, recurringId: `r-${id}`, name: id, oldAmountCents: -1000, newAmountCents: -1200 });

const base: AttentionInput = {
  staleAccounts: [],
  reminderDays: 7,
  toReview: 0,
  priceAlerts: [],
  balances: [],
  gaps: [],
};

describe("buildAttention", () => {
  it("is empty when nothing needs attention", () => {
    expect(buildAttention(base)).toEqual([]);
  });

  it("orders kinds and puts already-below accounts first", () => {
    const ahead: BalanceBreach = {
      date: "2025-09-20",
      balanceCents: 300,
      alreadyBelow: false,
      cause: {
        id: "r",
        accountId: "a1",
        name: "Rent",
        merchantKey: "rent",
        amountCents: -70000,
        interval: "monthly",
        status: "confirmed",
        lastSeenDate: "2025-08-20",
        date: "2025-09-20",
      },
      otherCount: 0,
    };
    const below: BalanceBreach = { date: "2025-09-01", balanceCents: 100, alreadyBelow: true, cause: null, otherCount: 0 };
    const items = buildAttention({
      staleAccounts: [stale("a1")],
      reminderDays: 7,
      toReview: 3,
      priceAlerts: [alert("p1")],
      balances: [balance("a1", ahead), balance("a2", below)],
      gaps: [{ accountId: "a1", name: "a1", amountCents: -100, from: "2025-09-01", to: "2025-09-02" }],
    });
    expect(items.map((i) => i.kind)).toEqual([
      "belowNow",
      "balanceGap",
      "staleImport",
      "review",
      "priceUp",
      "lowAhead",
    ]);
    expect(items[0]).toEqual({ kind: "belowNow", accountId: "a2", name: "a2", thresholdCents: 500 });
    expect(items[5]).toMatchObject({
      kind: "lowAhead",
      date: "2025-09-20",
      balanceCents: 300,
      cause: { name: "Rent", amountCents: -70000, status: "confirmed" },
    });
  });

  it("groups price alerts at three", () => {
    expect(buildAttention({ ...base, priceAlerts: [alert("a"), alert("b")] }).map((i) => i.kind)).toEqual(["priceUp", "priceUp"]);
    expect(buildAttention({ ...base, priceAlerts: [alert("a"), alert("b"), alert("c")] })).toEqual([
      { kind: "pricesUp", count: 3 },
    ]);
  });

  it("ignores stale accounts when reminders are off", () => {
    expect(buildAttention({ ...base, staleAccounts: [stale("a")], reminderDays: null })).toEqual([]);
  });

  it("emits a low-ahead item without a cause", () => {
    const breach: BalanceBreach = { date: "2025-09-05", balanceCents: 10, alreadyBelow: false, cause: null, otherCount: 0 };
    expect(buildAttention({ ...base, balances: [balance("a", breach)] })[0]).toMatchObject({ kind: "lowAhead", cause: null });
  });

  it("puts balance gaps after below-threshold accounts and before the import reminder", () => {
    const below: BalanceBreach = { date: "2025-09-01", balanceCents: 100, alreadyBelow: true, cause: null, otherCount: 0 };
    const gap = { accountId: "g", name: "g", amountCents: -4210, from: "2025-09-03", to: "2025-09-09" };
    const items = buildAttention({
      ...base,
      balances: [balance("a", below)],
      staleAccounts: [stale("s")],
      toReview: 2,
      gaps: [gap],
    });
    expect(items.map((i) => i.kind)).toEqual(["belowNow", "balanceGap", "staleImport", "review"]);
    expect(items[1]).toEqual({ kind: "balanceGap", ...gap });
  });

  it("lists one row per account with a gap", () => {
    const gap = (id: string) => ({ accountId: id, name: id, amountCents: 500, from: "2025-09-03", to: "2025-09-09" });
    expect(buildAttention({ ...base, gaps: [gap("a"), gap("b")] }).map((i) => i.kind)).toEqual(["balanceGap", "balanceGap"]);
  });
});

describe("buildAttention bank health", () => {
  it("lists reconnect and failing rows right after the below-now alerts", () => {
    const items = buildAttention({
      ...base,
      toReview: 2,
      balances: [balance("a", { date: "2025-09-01", balanceCents: 100, alreadyBelow: true, cause: null, otherCount: 0 })],
      gaps: [{ accountId: "g", name: "g", amountCents: -100, from: "2025-09-01", to: "2025-09-02" }],
      bankReconnects: [{ connectionId: "c1", bankName: "B", expiresOn: "2026-10-12", expired: false, reason: "expiring" }],
      bankFailing: [{ connectionId: "c2", bankName: "B", since: "2026-10-03" }],
    });
    expect(items.map((i) => i.kind)).toEqual(["belowNow", "bankReconnect", "bankFailing", "balanceGap", "review"]);
  });

  it("adds a backup row right after the bank rows, only while the backup is failing", () => {
    const items = buildAttention({
      ...base,
      toReview: 1,
      bankFailing: [{ connectionId: "c2", bankName: "B", since: "2026-10-03" }],
      backupFailingSince: "2026-10-17",
    });
    expect(items.map((i) => i.kind)).toEqual(["bankFailing", "backupFailing", "review"]);
    expect(items[1]).toEqual({ kind: "backupFailing", since: "2026-10-17" });
    expect(buildAttention({ ...base, backupFailingSince: null })).toEqual([]);
  });

  it("adds one row for rows added by hand that the bank never showed, right after the gaps", () => {
    const gap = { accountId: "a", name: "a", amountCents: 500, from: "2025-09-03", to: "2025-09-09" };
    const items = buildAttention({ ...base, gaps: [gap], notFound: 3, toReview: 1 });
    expect(items.map((i) => i.kind)).toEqual(["balanceGap", "notFound", "review"]);
    expect(items[1]).toEqual({ kind: "notFound", count: 3 });
    expect(buildAttention({ ...base, notFound: 0 })).toEqual([]);
  });
});
