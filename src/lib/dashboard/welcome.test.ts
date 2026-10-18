import { describe, expect, it } from "vitest";

import { buildWelcomeSteps } from "./welcome";

const none = { hasTransactions: false, toReview: 0, hasBalance: false, hasBudget: false, bankSync: false, hasBankLink: false };

describe("buildWelcomeSteps", () => {
  it("starts with nothing done and import next", () => {
    const r = buildWelcomeSteps(none);
    expect(r.steps.map((s) => s.key)).toEqual(["import", "balance", "review", "budget"]);
    expect(r.doneCount).toBe(0);
    expect(r.nextKey).toBe("import");
    expect(r.allDone).toBe(false);
  });

  it("offers the bank first to users with bank sync", () => {
    const r = buildWelcomeSteps({ ...none, bankSync: true });
    expect(r.steps.map((s) => s.key)).toEqual(["bank", "balance", "review", "budget"]);
    expect(r.nextKey).toBe("bank");
  });

  it("ticks the bank step with only a link, or with transactions", () => {
    expect(buildWelcomeSteps({ ...none, bankSync: true, hasBankLink: true }).steps[0]?.done).toBe(true);
    expect(buildWelcomeSteps({ ...none, bankSync: true, hasTransactions: true }).steps[0]?.done).toBe(true);
  });

  it("does not tick review before any transaction", () => {
    expect(buildWelcomeSteps(none).steps[2]?.done).toBe(false);
  });

  it("ticks review only when the queue is empty", () => {
    const pending = buildWelcomeSteps({ ...none, hasTransactions: true, toReview: 3 });
    expect(pending.steps.map((s) => s.done)).toEqual([true, false, false, false]);
    expect(pending.nextKey).toBe("balance");
    const cleared = buildWelcomeSteps({ ...none, hasTransactions: true, hasBalance: true });
    expect(cleared.steps.map((s) => s.done)).toEqual([true, true, true, false]);
    expect(cleared.nextKey).toBe("budget");
  });

  it("points at the first undone step even when later ones are done", () => {
    const r = buildWelcomeSteps({ ...none, hasTransactions: true, toReview: 2, hasBalance: true, hasBudget: true });
    expect(r.doneCount).toBe(3);
    expect(r.nextKey).toBe("review");
  });

  it("is allDone when the four are done", () => {
    const r = buildWelcomeSteps({ ...none, hasTransactions: true, hasBalance: true, hasBudget: true });
    expect(r.allDone).toBe(true);
    expect(r.doneCount).toBe(4);
    expect(r.nextKey).toBeNull();
  });
});
