import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAutosave } from "./autosave";

describe("createAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for the delay and saves only the last value", () => {
    const save = vi.fn();
    const a = createAutosave<string>({ delayMs: 1000, save });
    a.schedule("a");
    vi.advanceTimersByTime(600);
    a.schedule("ab");
    vi.advanceTimersByTime(999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("ab");
  });

  it("flush saves now and the timer does not save again", async () => {
    const save = vi.fn();
    const a = createAutosave<string>({ delayMs: 1000, save });
    a.schedule("x");
    await a.flush();
    expect(save).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledOnce();
    await a.flush();
    expect(save).toHaveBeenCalledOnce();
  });

  it("skips a value equal to the saved one", async () => {
    const save = vi.fn();
    const a = createAutosave<string>({ delayMs: 10, save });
    a.setSaved("same");
    a.schedule("same");
    await a.flush();
    expect(save).not.toHaveBeenCalled();
    a.schedule("other");
    await a.flush();
    a.schedule("other");
    await a.flush();
    expect(save).toHaveBeenCalledOnce();
  });

  it("cancel drops the pending value", () => {
    const save = vi.fn();
    const a = createAutosave<string>({ delayMs: 10, save });
    a.schedule("x");
    a.cancel();
    vi.advanceTimersByTime(50);
    expect(save).not.toHaveBeenCalled();
    expect(a.hasPending()).toBe(false);
  });

  it("uses a custom equality", async () => {
    const save = vi.fn();
    const a = createAutosave<string>({ delayMs: 10, save, equals: (x, y) => x.trim() === y.trim() });
    a.setSaved("hi");
    a.schedule(" hi ");
    await a.flush();
    expect(save).not.toHaveBeenCalled();
  });
});
