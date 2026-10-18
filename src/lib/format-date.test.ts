// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatDateTime, formatDay, formatDayRange, formatShortDay, formatShortInstant, formatShortInstantTime, formatTimeAgo, formatInstantTimeOrDay } from "./format-date";

describe("formatDateTime", () => {
  it("formats in Europe/Paris whatever the runtime zone", () => {
    expect(formatDateTime(new Date("2025-01-15T09:05:00Z"), "fr")).toBe("15/01/2025 10:05");
    expect(formatDateTime(new Date("2025-07-31T22:30:00Z"), "fr")).toBe("01/08/2025 00:30");
  });

  it("is day-first in English too", () => {
    expect(formatDateTime(new Date("2025-01-15T09:05:00Z"), "en")).toBe("15/01/2025, 10:05");
    expect(formatDateTime(new Date("2025-07-31T22:30:00Z"), "en")).toBe("01/08/2025, 00:30");
  });
});

describe("formatDay", () => {
  const today = "2026-09-30";

  it("says Today, Yesterday and Tomorrow in both languages", () => {
    expect(formatDay("2026-09-30", today, "en")).toBe("Today");
    expect(formatDay("2026-09-29", today, "en")).toBe("Yesterday");
    expect(formatDay("2026-10-01", today, "en")).toBe("Tomorrow");
    expect(formatDay("2026-09-30", today, "fr")).toBe("Aujourd’hui");
    expect(formatDay("2026-09-29", today, "fr")).toBe("Hier");
  });

  it("gives weekday, day and month otherwise, without the current year", () => {
    expect(formatDay("2026-09-28", today, "en")).toBe("Mon 28 Sept");
    expect(formatDay("2026-09-28", today, "fr")).toBe("lun. 28 sept.");
  });

  it("adds the year when it isn't the current one", () => {
    expect(formatDay("2025-09-28", today, "en")).toMatch(/^Sun,? 28 Sept 2025$/);
    expect(formatDay("2025-09-28", today, "fr")).toBe("dim. 28 sept. 2025");
  });

  it("crosses month and year boundaries by calendar day", () => {
    expect(formatDay("2025-12-31", "2026-01-01", "en")).toBe("Yesterday");
    expect(formatDay("2026-02-28", "2026-03-01", "fr")).toBe("Hier");
    expect(formatDay("2026-03-29", "2026-03-30", "en")).toBe("Yesterday"); // DST change in Paris
  });

  it("returns non-ISO input unchanged", () => {
    expect(formatDay("28/09/2026", today, "en")).toBe("28/09/2026");
  });
});

describe("formatShortDay", () => {
  it("gives day and month, never a relative word", () => {
    expect(formatShortDay("2026-09-30", "2026-09-30", "en")).toBe("30 Sept");
    expect(formatShortDay("2026-10-05", "2026-09-30", "fr")).toBe("5 oct.");
  });

  it("adds the year when it isn't the current one", () => {
    expect(formatShortDay("2025-12-24", "2026-01-02", "en")).toBe("24 Dec 2025");
    expect(formatShortDay("2025-12-24", "2026-01-02", "fr")).toBe("24 déc. 2025");
  });
});

describe("formatDayRange", () => {
  it("shows the year on both ends when the years differ", () => {
    expect(formatDayRange("2025-10-12", "2026-09-29", "2026-10-01", "en")).toMatch(/^12 Oct 2025 → 29 Sep(t)? 2026$/);
  });
  it("follows formatShortDay when both ends share a year", () => {
    const text = formatDayRange("2026-03-02", "2026-03-20", "2026-10-01", "en");
    expect(text).toBe(`${formatShortDay("2026-03-02", "2026-10-01", "en")} → ${formatShortDay("2026-03-20", "2026-10-01", "en")}`);
  });
});

describe("formatShortInstant", () => {
  it("uses the Paris calendar day, not the UTC one", () => {
    // 22:30 UTC on 12 Sept is 00:30 on 13 Sept in Paris (summer time).
    expect(formatShortInstant(new Date("2026-09-12T22:30:00Z"), "2026-10-02", "en")).toBe("13 Sept");
    expect(formatShortInstant(new Date("2026-09-12T10:00:00Z"), "2026-10-02", "en")).toBe("12 Sept");
  });

  it("adds the year only when it differs from today's", () => {
    expect(formatShortInstant(new Date("2025-09-12T10:00:00Z"), "2026-10-02", "en")).toContain("2025");
  });

  it("formats in French", () => {
    expect(formatShortInstant(new Date("2026-09-12T10:00:00Z"), "2026-10-02", "fr")).toBe("12 sept.");
  });
});

describe("formatShortInstantTime", () => {
  it("shows the Paris day and 24-hour time", () => {
    // 05:00 UTC on 2 Oct is 07:00 in Paris (summer time).
    expect(formatShortInstantTime(new Date("2026-10-02T05:00:00Z"), "2026-10-05", "en")).toBe("2 Oct 07:00");
    expect(formatShortInstantTime(new Date("2026-10-02T22:05:00Z"), "2026-10-05", "en")).toBe("3 Oct 00:05");
  });

  it("formats in French", () => {
    expect(formatShortInstantTime(new Date("2026-10-02T05:00:00Z"), "2026-10-05", "fr")).toBe("2 oct. 07:00");
  });
});

describe("formatTimeAgo", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("picks minutes, hours or days", () => {
    expect(formatTimeAgo(ago(30_000), now, "en")).toMatch(/this minute|0 min/);
    expect(formatTimeAgo(ago(5 * 60_000), now, "en")).toMatch(/^5 min/);
    expect(formatTimeAgo(ago(2 * 3_600_000 + 5 * 60_000), now, "en")).toMatch(/^2 hr/);
    expect(formatTimeAgo(ago(3 * 86_400_000), now, "en")).toMatch(/^3 days/);
  });

  it("speaks French and never reads the future", () => {
    expect(formatTimeAgo(ago(2 * 3_600_000), now, "fr")).toMatch(/^il y a 2\sh/);
    expect(formatTimeAgo(new Date(now.getTime() + 60_000), now, "en")).toBe(formatTimeAgo(now, now, "en"));
  });
});

describe("formatInstantTimeOrDay", () => {
  it("shows only the time for today, else day and time (Paris)", () => {
    const at = new Date("2026-10-05T05:00:00Z");
    expect(formatInstantTimeOrDay(at, "2026-10-05", "en")).toBe("07:00");
    expect(formatInstantTimeOrDay(at, "2026-10-06", "en")).toBe("5 Oct 07:00");
  });
});
