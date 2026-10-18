import { describe, expect, it } from "vitest";

import {
  comingUp,
  forecastMonth,
  projectOccurrences,
  summarizeForecast,
  type ForecastItem,
} from "./forecast";

function item(overrides: Partial<ForecastItem> & Pick<ForecastItem, "id">): ForecastItem {
  return {
    accountId: "acc-1",
    name: overrides.id,
    merchantKey: overrides.id,
    amountCents: -1000,
    interval: "monthly",
    status: "confirmed",
    lastSeenDate: "2025-11-01",
    ...overrides,
  };
}

const RENT = item({
  id: "rent",
  name: "VIR LOYER APPARTEMENT",
  amountCents: -75000,
  lastSeenDate: "2025-11-05",
});
const PHONE = item({
  id: "phone",
  name: "PRLV ORANGE SA",
  amountCents: -6650,
  lastSeenDate: "2025-11-29",
});
const GYM = item({
  id: "gym",
  name: "CB GYM WEEKLY",
  amountCents: -1500,
  interval: "weekly",
  lastSeenDate: "2025-11-26", // Thursdays
});
const INSURANCE = item({
  id: "insurance",
  name: "PRLV ASSURANCE LOGIS",
  amountCents: -21000,
  interval: "quarterly",
  lastSeenDate: "2025-10-12",
});
const DOMAIN = item({
  id: "domain",
  name: "CB DOMAIN RENEWAL",
  amountCents: -1499,
  interval: "yearly",
  lastSeenDate: "2025-01-20",
});
const SALARY = item({
  id: "salary",
  name: "VIR SEPA ATELIER LUMEN",
  amountCents: 250000,
  lastSeenDate: "2025-11-28",
});
const NETFLIX = item({
  id: "netflix",
  name: "CB NETFLIX.COM",
  amountCents: -1399,
  status: "detected",
  lastSeenDate: "2025-11-15",
});
const DISMISSED = item({
  id: "dismissed",
  name: "CB OLD GYM",
  amountCents: -3000,
  status: "dismissed",
  lastSeenDate: "2025-11-10",
});

const ALL = [RENT, PHONE, GYM, INSURANCE, DOMAIN, SALARY, NETFLIX, DISMISSED];

describe("forecastMonth", () => {
  const december = forecastMonth(ALL, "2025-12");

  it("projects each item into the month with the right multiplicity", () => {
    const byId = (id: string) => december.entries.filter((e) => e.id === id).map((e) => e.date);
    expect(byId("rent")).toEqual(["2025-12-05"]);
    expect(byId("phone")).toEqual(["2025-12-29"]);
    // Thursdays: Dec 3, 10, 17, 24, 31.
    expect(byId("gym")).toEqual([
      "2025-12-03",
      "2025-12-10",
      "2025-12-17",
      "2025-12-24",
      "2025-12-31",
    ]);
    expect(byId("insurance")).toEqual([]); // next due 2026-01-12
    expect(byId("domain")).toEqual([]);
    expect(byId("salary")).toEqual(["2025-12-28"]);
    expect(byId("netflix")).toEqual(["2025-12-15"]);
  });

  it("excludes dismissed items", () => {
    expect(december.entries.some((e) => e.id === "dismissed")).toBe(false);
  });

  it("separates outflows from income and nets them", () => {
    // Confirmed: rent 75000 + phone 6650 + gym 5 x 1500 = 89150 out; salary in.
    expect(december.summary.confirmed).toEqual({
      outCents: 89150,
      inCents: 250000,
      netCents: 250000 - 89150,
    });
  });

  it("adds detected items on top of confirmed in `all`", () => {
    expect(december.summary.all).toEqual({
      outCents: 89150 + 1399,
      inCents: 250000,
      netCents: 250000 - 89150 - 1399,
    });
    expect(december.summary.detectedCount).toBe(1);
    expect(december.summary.count).toBe(december.entries.length);
  });

  it("includes quarterly and yearly items only in the month they fall due", () => {
    const january = forecastMonth(ALL, "2026-01");
    expect(january.entries.filter((e) => e.id === "insurance").map((e) => e.date)).toEqual([
      "2026-01-12",
    ]);
    expect(january.entries.filter((e) => e.id === "domain").map((e) => e.date)).toEqual([
      "2026-01-20",
    ]);
    const february = forecastMonth(ALL, "2026-02");
    expect(february.entries.some((e) => e.id === "insurance")).toBe(false);
    expect(february.entries.some((e) => e.id === "domain")).toBe(false);
  });

  it("keeps a monthly item overdue by several months in the forecast", () => {
    const stale = item({ id: "stale", lastSeenDate: "2025-06-10", amountCents: -2000 });
    const { entries } = forecastMonth([stale], "2025-12");
    expect(entries.map((e) => e.date)).toEqual(["2025-12-10"]);
  });

  it("rolls the year over from December to January", () => {
    const january = forecastMonth([RENT, SALARY], "2026-01");
    expect(january.entries.map((e) => e.date)).toEqual(["2026-01-05", "2026-01-28"]);
  });

  it("sorts by date, then name, then id", () => {
    const a = item({ id: "b-id", name: "Same", lastSeenDate: "2025-11-05" });
    const b = item({ id: "a-id", name: "Same", lastSeenDate: "2025-11-05" });
    const c = item({ id: "c-id", name: "Alpha", lastSeenDate: "2025-11-05" });
    const { entries } = forecastMonth([a, b, c], "2025-12");
    expect(entries.map((e) => e.id)).toEqual(["c-id", "a-id", "b-id"]);
  });

  it("handles empty input", () => {
    const empty = forecastMonth([], "2025-12");
    const zero = { outCents: 0, inCents: 0, netCents: 0 };
    expect(empty.entries).toEqual([]);
    expect(empty.summary).toEqual({ confirmed: zero, all: zero, count: 0, detectedCount: 0 });
  });
});

describe("projectOccurrences", () => {
  it("returns nothing for dismissed items", () => {
    expect(projectOccurrences([DISMISSED], "2025-12-01", "2025-12-31")).toEqual([]);
  });

  it("returns nothing for ended items", () => {
    const ended = { ...RENT, id: "ended", status: "ended" as const };
    expect(projectOccurrences([ended], "2025-12-01", "2025-12-31")).toEqual([]);
  });
});

describe("summarizeForecast", () => {
  it("ignores dismissed entries defensively", () => {
    const summary = summarizeForecast([{ ...DISMISSED, date: "2025-12-10" }]);
    expect(summary.count).toBe(0);
    expect(summary.all.outCents).toBe(0);
  });

  it("ignores ended entries defensively", () => {
    const summary = summarizeForecast([{ ...RENT, status: "ended", date: "2025-12-10" }]);
    expect(summary.count).toBe(0);
  });
});

describe("comingUp", () => {
  it("lists occurrences within the window, soonest first, capped at the limit", () => {
    const entries = comingUp(ALL, "2025-12-01");
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.date)).toEqual([
      "2025-12-03",
      "2025-12-05",
      "2025-12-10",
      "2025-12-15",
      "2025-12-17",
    ]);
  });

  it("respects a custom limit and a wider window", () => {
    const entries = comingUp(ALL, "2025-12-01", 60, 100);
    // Window ends 2026-01-30; the last occurrence in it is the phone on the 29th.
    expect(entries.at(-1)?.date).toBe("2026-01-29");
    expect(entries.every((e) => e.date >= "2025-12-01" && e.date <= "2026-01-30")).toBe(true);
    expect(entries.map((e) => e.date)).toEqual([...entries.map((e) => e.date)].sort());
  });

  it("includes both window endpoints and drops past-due dates", () => {
    // Today is included; today + 30 days (2026-01-04) stops short of Jan 5.
    expect(comingUp([RENT], "2025-12-05", 30).map((e) => e.date)).toEqual(["2025-12-05"]);
    expect(comingUp([RENT], "2025-12-06", 30).map((e) => e.date)).toEqual(["2026-01-05"]);
    expect(comingUp([RENT], "2025-12-06", 30, 0)).toEqual([]);
  });

  it("is empty with no items", () => {
    expect(comingUp([], "2025-12-01")).toEqual([]);
  });
});
