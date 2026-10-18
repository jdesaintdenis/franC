import { describe, expect, it } from "vitest";

import type { ForecastItem } from "../recurring/forecast";
import { projectOccurrences } from "../recurring/forecast";
import {
  buildBalanceOverview,
  combineSeries,
  firstBreach,
  lowestPoint,
  projectBalance,
  type AccountBalanceInput,
} from "./projection";

function item(overrides: Partial<ForecastItem> & Pick<ForecastItem, "id">): ForecastItem {
  return {
    accountId: "A",
    name: overrides.id,
    merchantKey: overrides.id,
    amountCents: -1000,
    interval: "monthly",
    status: "confirmed",
    lastSeenDate: "2026-08-01",
    ...overrides,
  };
}

const LOYER = item({ id: "loyer", name: "Loyer", amountCents: -85000, lastSeenDate: "2026-09-03" });
const NETFLIX = item({ id: "netflix", name: "Netflix", amountCents: -1399, lastSeenDate: "2026-09-10" });
const SALAIRE = item({ id: "salaire", name: "Salaire", amountCents: 250000, lastSeenDate: "2026-08-28" });

function account(overrides: Partial<AccountBalanceInput> = {}): AccountBalanceInput {
  return { accountId: "A", name: "Compte courant", balanceCents: 100000, asOf: "2026-09-29", thresholdCents: 0, ...overrides };
}

describe("projectBalance", () => {
  it("gives one end-of-day point per day, asOf + 1 through to inclusive", () => {
    const entries = projectOccurrences([LOYER], "2026-09-30", "2026-10-05");
    const series = projectBalance({ balanceCents: 100000, asOf: "2026-09-29", entries, to: "2026-10-05" });
    expect(series.map((p) => p.date)).toEqual([
      "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
    ]);
    expect(series.map((p) => p.balanceCents)).toEqual([100000, 100000, 100000, 15000, 15000, 15000]);
    expect(series[3].entries.map((e) => e.name)).toEqual(["Loyer"]);
    expect(series[0].entries).toEqual([]);
  });

  it("is empty when asOf is on or after to", () => {
    expect(projectBalance({ balanceCents: 5, asOf: "2026-10-01", entries: [], to: "2026-10-01" })).toEqual([]);
    expect(projectBalance({ balanceCents: 5, asOf: "2026-10-02", entries: [], to: "2026-10-01" })).toEqual([]);
  });

  it("ignores entries outside the window and sums several entries of one day", () => {
    const entries = [
      { ...NETFLIX, date: "2026-09-29" }, // on asOf: already in the balance
      { ...NETFLIX, date: "2026-10-01" },
      { ...LOYER, date: "2026-10-01" },
      { ...NETFLIX, date: "2026-10-09" }, // after to
    ];
    const series = projectBalance({ balanceCents: 100000, asOf: "2026-09-29", entries, to: "2026-10-02" });
    const after = 100000 - 1399 - 85000;
    expect(series.map((p) => p.balanceCents)).toEqual([100000, after, after]);
    expect(series[1].entries).toHaveLength(2);
  });

  it("handles weekly items", () => {
    const gym = item({ id: "gym", name: "Salle de sport", amountCents: -1000, interval: "weekly", lastSeenDate: "2026-09-28" });
    const entries = projectOccurrences([gym], "2026-09-30", "2026-10-20");
    const series = projectBalance({ balanceCents: 10000, asOf: "2026-09-29", entries, to: "2026-10-20" });
    const hits = series.filter((p) => p.entries.length > 0).map((p) => p.date);
    expect(hits).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(series.at(-1)?.balanceCents).toBe(7000);
  });

  it("clamps a monthly item on the 31st to the month's last day", () => {
    const assurance = item({ id: "assurance", name: "Assurance", amountCents: -4000, lastSeenDate: "2026-07-31" });
    const entries = projectOccurrences([assurance], "2026-09-01", "2026-12-31");
    const series = projectBalance({ balanceCents: 0, asOf: "2026-08-31", entries, to: "2026-12-31" });
    expect(series.filter((p) => p.entries.length > 0).map((p) => p.date)).toEqual([
      "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31",
    ]);
  });

  it("handles quarterly and yearly items", () => {
    const taxe = item({ id: "taxe", name: "Taxe foncière", amountCents: -60000, interval: "quarterly", lastSeenDate: "2026-07-15" });
    const mutuelle = item({ id: "mutuelle", name: "Mutuelle", amountCents: -30000, interval: "yearly", lastSeenDate: "2025-11-20" });
    const entries = projectOccurrences([taxe, mutuelle], "2026-09-30", "2026-11-28");
    const series = projectBalance({ balanceCents: 200000, asOf: "2026-09-29", entries, to: "2026-11-28" });
    expect(series.filter((p) => p.entries.length > 0).map((p) => [p.date, p.entries[0].name])).toEqual([
      ["2026-10-15", "Taxe foncière"],
      ["2026-11-20", "Mutuelle"],
    ]);
    expect(series.at(-1)?.balanceCents).toBe(110000);
  });

  it("ignores dismissed items and keeps detected ones with their status", () => {
    const dismissed = item({ id: "old", name: "Ancien abonnement", status: "dismissed", lastSeenDate: "2026-09-03" });
    const detected = item({ id: "spotify", name: "Spotify", amountCents: -1099, status: "detected", lastSeenDate: "2026-09-05" });
    const overview = buildBalanceOverview({ accounts: [account()], items: [dismissed, detected], today: "2026-09-29" });
    const entries = overview.accounts[0].series.flatMap((p) => p.entries);
    expect(entries.map((e) => [e.name, e.status])).toEqual([["Spotify", "detected"]]);
    expect(overview.accounts[0].series.at(-1)?.balanceCents).toBe(100000 - 1099);
  });
});

describe("lowestPoint", () => {
  const fallback = { date: "2026-09-29", balanceCents: 5000 };

  it("returns the earliest day among equal minimums", () => {
    const series = [
      { date: "2026-09-30", balanceCents: 4000 },
      { date: "2026-10-01", balanceCents: 1000 },
      { date: "2026-10-02", balanceCents: 1000 },
      { date: "2026-10-03", balanceCents: 3000 },
    ];
    expect(lowestPoint(series, fallback)).toEqual({ date: "2026-10-01", balanceCents: 1000 });
  });

  it("falls back to the current balance when nothing goes lower", () => {
    const series = [{ date: "2026-09-30", balanceCents: 5000 }, { date: "2026-10-01", balanceCents: 9000 }];
    expect(lowestPoint(series, fallback)).toEqual(fallback);
    expect(lowestPoint([], fallback)).toEqual(fallback);
  });
});

describe("firstBreach", () => {
  const day = (date: string, balanceCents: number, entries = [] as ReturnType<typeof projectOccurrences>) => ({ date, balanceCents, entries });
  const loyer = { ...LOYER, date: "2026-10-03" };
  const netflix = { ...NETFLIX, date: "2026-10-03" };
  const salaire = { ...SALAIRE, date: "2026-10-03" };

  it("does not warn when the balance is exactly at the threshold", () => {
    expect(firstBreach([day("2026-10-03", 0, [loyer])], 0)).toBeNull();
  });

  it("warns on the first day strictly below", () => {
    const breach = firstBreach([day("2026-10-02", 100), day("2026-10-03", -1, [loyer]), day("2026-10-04", -500)], 0);
    expect(breach).toMatchObject({ date: "2026-10-03", balanceCents: -1, alreadyBelow: false, otherCount: 0 });
    expect(breach?.cause?.name).toBe("Loyer");
  });

  it("supports a custom threshold", () => {
    const series = [day("2026-10-01", 20000), day("2026-10-02", 9000, [netflix])];
    expect(firstBreach(series, 0)).toBeNull();
    expect(firstBreach(series, 10000)?.date).toBe("2026-10-02");
  });

  it("picks the largest outflow as cause and counts the other outflows, ignoring inflows", () => {
    const breach = firstBreach([day("2026-10-03", -50000, [netflix, salaire, loyer])], 0);
    expect(breach?.cause?.name).toBe("Loyer");
    expect(breach?.otherCount).toBe(1);
  });

  it("breaks cause ties by entry order", () => {
    const a = { ...NETFLIX, id: "a", name: "Netflix", date: "2026-10-03" };
    const b = { ...NETFLIX, id: "b", name: "Disney+", date: "2026-10-03" };
    expect(firstBreach([day("2026-10-03", -1, [a, b])], 0)?.cause?.id).toBe("a");
  });

  it("reports an already-below balance on asOf with no cause", () => {
    const breach = firstBreach([day("2026-10-01", -3000)], 0, { date: "2026-09-29", balanceCents: -2000 });
    expect(breach).toEqual({ date: "2026-09-29", balanceCents: -2000, alreadyBelow: true, cause: null, otherCount: 0 });
  });

  it("returns null when it never goes below", () => {
    expect(firstBreach([day("2026-10-01", 500), day("2026-10-02", 400)], 0, { date: "2026-09-29", balanceCents: 600 })).toBeNull();
  });
});

describe("combineSeries", () => {
  it("combines accounts with different asOf dates, carrying values forward", () => {
    const a = { balanceCents: 1000, asOf: "2026-10-01", series: [
      { date: "2026-10-02", balanceCents: 900 },
      { date: "2026-10-03", balanceCents: 900 },
      { date: "2026-10-04", balanceCents: 700 },
    ] };
    const b = { balanceCents: 500, asOf: "2026-10-03", series: [{ date: "2026-10-04", balanceCents: 400 }] };
    expect(combineSeries([a, b], "2026-10-02", "2026-10-05")).toEqual([
      { date: "2026-10-02", balanceCents: 1400 },
      { date: "2026-10-03", balanceCents: 1400 },
      { date: "2026-10-04", balanceCents: 1100 },
      { date: "2026-10-05", balanceCents: 1100 },
    ]);
  });

  it("is empty when from is after to", () => {
    expect(combineSeries([], "2026-10-02", "2026-10-01")).toEqual([]);
  });
});

describe("buildBalanceOverview", () => {
  it("builds per-account and total views, filtering items by account", () => {
    const savings = item({ id: "livret", accountId: "B", name: "Virement épargne", amountCents: 10000, lastSeenDate: "2026-09-05" });
    const overview = buildBalanceOverview({
      accounts: [
        account({ balanceCents: 100000 }),
        account({ accountId: "B", name: "Livret", balanceCents: 50000 }),
      ],
      items: [LOYER, savings],
      today: "2026-09-29",
    });
    const [a, b] = overview.accounts;
    expect(a.series).toHaveLength(30);
    expect(a.series.at(-1)?.date).toBe("2026-10-29");
    expect(a.series.at(-1)?.balanceCents).toBe(100000 - 85000);
    expect(b.series.at(-1)?.balanceCents).toBe(60000);
    expect(overview.total.balanceCents).toBe(150000);
    expect(overview.total.series.at(-1)).toEqual({ date: "2026-10-29", balanceCents: 15000 + 60000 });
    expect(overview.total.lowest).toEqual({ date: "2026-10-03", balanceCents: 65000 });
    expect(a.lowest).toEqual({ date: "2026-10-03", balanceCents: 15000 });
    expect(b.lowest).toEqual({ date: "2026-09-29", balanceCents: 50000 });
  });

  it("reports a breach with its cause", () => {
    const overview = buildBalanceOverview({
      accounts: [account({ balanceCents: 50000 })],
      items: [LOYER, NETFLIX],
      today: "2026-09-29",
    });
    const breach = overview.accounts[0].breach;
    expect(breach?.date).toBe("2026-10-03");
    expect(breach?.cause?.name).toBe("Loyer");
    expect(breach?.balanceCents).toBe(50000 - 85000);
  });

  it("uses a custom threshold per account", () => {
    const overview = buildBalanceOverview({
      accounts: [account({ balanceCents: 100000, thresholdCents: 20000 })],
      items: [LOYER],
      today: "2026-09-29",
    });
    expect(overview.accounts[0].breach?.date).toBe("2026-10-03");
  });

  it("flags entries dated before today as since the last import", () => {
    const overview = buildBalanceOverview({
      accounts: [account({ asOf: "2026-09-25", balanceCents: 300000 })],
      items: [item({ id: "elec", name: "EDF", amountCents: -6000, lastSeenDate: "2026-08-27" }), NETFLIX],
      today: "2026-09-29",
    });
    const acc = overview.accounts[0];
    expect(acc.series[0].date).toBe("2026-09-26");
    expect(acc.sinceLastImport.map((e) => [e.name, e.date])).toEqual([["EDF", "2026-09-27"]]);
    // Netflix falls on 2026-10-10, after today.
    expect(acc.sinceLastImport.some((e) => e.name === "Netflix")).toBe(false);
  });

  it("keeps the total unchanged across a transfer already in both balances", () => {
    // -500 on A and +500 on B are ordinary transactions: they are already in each balance.
    const before = buildBalanceOverview({
      accounts: [account({ balanceCents: 100000 }), account({ accountId: "B", balanceCents: 20000 })],
      items: [],
      today: "2026-09-29",
    });
    const after = buildBalanceOverview({
      accounts: [account({ balanceCents: 99500 }), account({ accountId: "B", balanceCents: 20500 })],
      items: [],
      today: "2026-09-29",
    });
    expect(after.total.balanceCents).toBe(before.total.balanceCents);
    expect(after.total.series).toEqual(before.total.series);
  });

  it("starts the total series at the earliest asOf + 1 and copes with an asOf in the future", () => {
    const overview = buildBalanceOverview({
      accounts: [account({ asOf: "2026-09-20" }), account({ accountId: "B", asOf: "2026-12-01", balanceCents: 1 })],
      items: [],
      today: "2026-09-29",
    });
    expect(overview.total.series[0].date).toBe("2026-09-21");
    expect(overview.accounts[1].series).toEqual([]);
    expect(overview.total.series.at(-1)).toEqual({ date: "2026-10-29", balanceCents: 100001 });
  });

  it("returns an empty overview without accounts", () => {
    const overview = buildBalanceOverview({ accounts: [], items: [], today: "2026-09-29" });
    expect(overview.accounts).toEqual([]);
    expect(overview.total.balanceCents).toBe(0);
  });
});
