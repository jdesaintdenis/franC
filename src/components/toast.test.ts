import { describe, expect, it } from "vitest";

import { activeViewport, ERROR_TOAST_DURATION_MS, TOAST_DURATION_MS, toastDuration } from "./toast";

describe("toastDuration", () => {
  it("keeps errors on screen longer than confirmations", () => {
    expect(toastDuration("success")).toBe(TOAST_DURATION_MS);
    expect(toastDuration(undefined)).toBe(TOAST_DURATION_MS);
    expect(toastDuration("error")).toBe(ERROR_TOAST_DURATION_MS);
    expect(ERROR_TOAST_DURATION_MS).toBeGreaterThan(TOAST_DURATION_MS);
  });
});

describe("activeViewport", () => {
  it("is the most recently mounted viewport (an open sheet's)", () => {
    expect(activeViewport([])).toBeNull();
    expect(activeViewport(["page", "sheet"])).toBe("sheet");
  });
});
