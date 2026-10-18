import { describe, expect, it } from "vitest";
import { consentValidUntil } from "./consent";

const now = new Date("2026-10-02T00:00:00Z");
const DAY = 86400;

describe("consentValidUntil", () => {
  it("defaults to 180 days", () => {
    expect(consentValidUntil(now).getTime()).toBe(now.getTime() + 180 * DAY * 1000);
  });
  it("caps by the bank's maximum", () => {
    expect(consentValidUntil(now, 90 * DAY).getTime()).toBe(now.getTime() + 90 * DAY * 1000);
  });
  it("keeps 180 days when the bank allows more", () => {
    expect(consentValidUntil(now, 365 * DAY).getTime()).toBe(now.getTime() + 180 * DAY * 1000);
  });
  it("ignores non-positive maximums", () => {
    expect(consentValidUntil(now, 0).getTime()).toBe(now.getTime() + 180 * DAY * 1000);
    expect(consentValidUntil(now, -5).getTime()).toBe(now.getTime() + 180 * DAY * 1000);
  });
});
