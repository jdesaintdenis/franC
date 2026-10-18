import { describe, expect, it } from "vitest";

import { swipeAxis, swipeOutcome } from "./swipe";

describe("swipeOutcome", () => {
  it("marks reviewed past a third of the width to the right", () => {
    expect(swipeOutcome(120, 5, 300)).toBe("reviewed");
  });
  it("skips past a third of the width to the left", () => {
    expect(swipeOutcome(-120, -5, 300)).toBe("skip");
  });
  it("does nothing below the threshold", () => {
    expect(swipeOutcome(80, 0, 300)).toBe("none");
    expect(swipeOutcome(-99, 0, 300)).toBe("none");
  });
  it("ignores mostly vertical drags", () => {
    expect(swipeOutcome(150, 200, 300)).toBe("none");
  });
  it("ignores a zero-width card", () => {
    expect(swipeOutcome(50, 0, 0)).toBe("none");
  });
});

describe("swipeAxis", () => {
  it("waits for enough movement", () => {
    expect(swipeAxis(3, 4)).toBeUndefined();
  });
  it("picks the dominant axis", () => {
    expect(swipeAxis(20, 5)).toBe("horizontal");
    expect(swipeAxis(5, -20)).toBe("vertical");
  });
});
