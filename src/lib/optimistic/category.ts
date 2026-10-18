/** What a row shows for its category; the same shape the list and the review queue carry. */
export interface CategoryRef {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  parentName: string | null;
}

/** The fields a hand categorization changes on a row, before the server has answered. */
export interface CategoryChangePatch {
  category: CategoryRef | null;
  categorySource: "manual" | null;
  reviewed: boolean;
}

export const CATEGORY_CHANGE_FIELDS = ["category", "categorySource", "reviewed"] as const;

/** Picks the display fields from a picker option (which also carries the label and parent id). */
export function categoryRefFromOption(option: CategoryRef): CategoryRef {
  return { id: option.id, name: option.name, color: option.color, icon: option.icon, parentName: option.parentName };
}

/** Looks the chosen category up; null (clearing) and unknown ids both give null. */
export function findCategoryRef(options: readonly CategoryRef[], categoryId: string | null): CategoryRef | null {
  if (categoryId === null) return null;
  const option = options.find((o) => o.id === categoryId);
  return option ? categoryRefFromOption(option) : null;
}

/** Like the server: a hand categorization is "manual" and marks the row reviewed; clearing has no source and puts it back to review. */
export function categoryChangePatch(category: CategoryRef | null): CategoryChangePatch {
  return { category, categorySource: category ? "manual" : null, reviewed: category !== null };
}
