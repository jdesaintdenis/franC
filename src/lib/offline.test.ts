import { afterEach, describe, expect, it, vi } from "vitest";

import { networkErrorMessage } from "./offline";

describe("networkErrorMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the fallback when online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    expect(networkErrorMessage("Import failed", "Offline")).toBe("Import failed");
  });

  it("returns the offline message when offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(networkErrorMessage("Import failed", "Offline")).toBe("Offline");
  });
});
