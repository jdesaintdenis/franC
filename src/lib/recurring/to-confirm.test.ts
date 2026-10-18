import { describe, expect, it } from "vitest";

import { splitSections, type SectionItem } from "./sections";
import { toConfirmQueue } from "./to-confirm";

const item = (id: string, status: SectionItem["status"], amount: number): SectionItem => ({
  id,
  name: id,
  status,
  typicalAmountCents: amount,
  interval: "monthly",
  categoryId: null,
});

describe("toConfirmQueue", () => {
  it("lists detected bills, then detected income, and skips confirmed, ended and dismissed items", () => {
    const sections = splitSections(
      [item("pay", "detected", 100), item("a", "detected", -100), item("b", "confirmed", -200), item("c", "ended", -300), item("d", "dismissed", -400), item("e", "detected", -500)],
      "next",
    );
    expect(toConfirmQueue(sections).map((i) => i.id)).toEqual(["a", "e", "pay"]);
  });

  it("is empty when nothing is detected", () => {
    expect(toConfirmQueue(splitSections([item("b", "confirmed", -200)], "next"))).toEqual([]);
  });
});
