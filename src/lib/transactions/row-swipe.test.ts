import { describe, expect, it } from "vitest";

import { clampRowOffset, rowSwipeOutcome } from "./row-swipe";

describe("rowSwipeOutcome", () => {
  it("right past 35% of the width opens the category picker", () => {
    expect(rowSwipeOutcome(150, 5, 400)).toBe("category");
  });

  it("left past the threshold opens more actions", () => {
    expect(rowSwipeOutcome(-150, 5, 400)).toBe("more");
  });

  it("does nothing under the threshold", () => {
    expect(rowSwipeOutcome(130, 0, 400)).toBeNull();
    expect(rowSwipeOutcome(-130, 0, 400)).toBeNull();
  });

  it("uses the 72px minimum on narrow rows", () => {
    expect(rowSwipeOutcome(60, 0, 100)).toBeNull();
    expect(rowSwipeOutcome(73, 0, 100)).toBe("category");
  });

  it("ignores vertical-dominant drags and bad widths", () => {
    expect(rowSwipeOutcome(150, 200, 400)).toBeNull();
    expect(rowSwipeOutcome(150, 0, 0)).toBeNull();
  });
});

describe("clampRowOffset", () => {
  it("limits the drag to 60% of the width either way", () => {
    expect(clampRowOffset(500, 400)).toBe(240);
    expect(clampRowOffset(-500, 400)).toBe(-240);
    expect(clampRowOffset(100, 400)).toBe(100);
  });
});

describe("swipe directions", () => {
  const rightOnly = { right: true, left: false };
  const leftOnly = { right: false, left: true };

  it("ignores a drag towards a disabled side", () => {
    expect(rowSwipeOutcome(150, 0, 400, leftOnly)).toBeNull();
    expect(rowSwipeOutcome(-150, 0, 400, rightOnly)).toBeNull();
  });

  it("still commits towards an enabled side", () => {
    expect(rowSwipeOutcome(150, 0, 400, rightOnly)).toBe("category");
    expect(rowSwipeOutcome(-150, 0, 400, leftOnly)).toBe("more");
  });

  it("keeps the row still towards a disabled side", () => {
    expect(clampRowOffset(100, 400, leftOnly)).toBe(0);
    expect(clampRowOffset(-100, 400, rightOnly)).toBe(0);
    expect(clampRowOffset(-100, 400, leftOnly)).toBe(-100);
  });
});
