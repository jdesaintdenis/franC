import type { SectionItem, Sections } from "./sections";

/** Detected items in the order the "À confirmer" block shows them: bills first, then income, each in section order. */
export function toConfirmQueue<T extends SectionItem>(sections: Sections<T>): T[] {
  return [...sections.bills, ...sections.income].filter((i) => i.status === "detected");
}
