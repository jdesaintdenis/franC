/**
 * Which categories to offer when adding a budget: those without one, biggest spenders first,
 * subcategories under their parent. Pure; the page supplies the 3-month averages
 * (`getBudgetPresets`) and translates the "No spending yet" case itself.
 */

export interface SuggestionCategory {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  parentId: string | null;
}

export interface Suggestion {
  category: SuggestionCategory;
  /** 3-month average monthly spending, rounded up to the euro; 0 when there is none. */
  averageCents: number;
  /** False for a budgeted parent shown only as the heading of its unbudgeted subcategories. */
  selectable: boolean;
}

export interface SuggestionGroup {
  parent: Suggestion;
  children: Suggestion[];
}

interface Input {
  categories: readonly SuggestionCategory[];
  budgetedIds: ReadonlySet<string>;
  /** Category id -> 3-month average; absent = no spending. */
  averages: ReadonlyMap<string, number>;
  locale: string;
}

function comparer(locale: string) {
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return (a: Suggestion, b: Suggestion) =>
    b.averageCents - a.averageCents || collator.compare(a.category.name, b.category.name);
}

/**
 * Groups of unbudgeted categories. A group is a top-level category with its unbudgeted
 * subcategories; a budgeted parent still heads its group (not selectable) when a subcategory
 * has no budget. Groups and children sort by average spending, then name. A parent's average
 * already includes its subcategories', so a parent never sorts below its own children.
 */
export function buildSuggestionGroups({ categories, budgetedIds, averages, locale }: Input): SuggestionGroup[] {
  const known = new Set(categories.map((c) => c.id));
  const toSuggestion = (category: SuggestionCategory): Suggestion => ({
    category,
    averageCents: averages.get(category.id) ?? 0,
    selectable: !budgetedIds.has(category.id),
  });
  const compare = comparer(locale);
  const childrenOf = new Map<string, Suggestion[]>();
  const tops: SuggestionCategory[] = [];
  for (const category of categories) {
    // An orphan (parent missing) counts as top-level, like the category tree does.
    if (category.parentId !== null && known.has(category.parentId)) {
      const list = childrenOf.get(category.parentId) ?? [];
      if (!budgetedIds.has(category.id)) list.push(toSuggestion(category));
      childrenOf.set(category.parentId, list);
    } else {
      tops.push(category);
    }
  }
  const groups: SuggestionGroup[] = [];
  for (const top of tops) {
    const parent = toSuggestion(top);
    const children = (childrenOf.get(top.id) ?? []).sort(compare);
    if (!parent.selectable && children.length === 0) continue;
    groups.push({ parent, children });
  }
  return groups.sort((a, b) => compare(a.parent, b.parent));
}

/** Selectable suggestions in display order (a group's parent, then its children). */
export function selectableSuggestions(groups: readonly SuggestionGroup[]): Suggestion[] {
  return groups.flatMap((g) => [g.parent, ...g.children]).filter((s) => s.selectable);
}

/** The best suggestions with real spending behind them, flat, for the empty state. */
export function topSuggestions({ limit, ...input }: Input & { limit: number }): Suggestion[] {
  const compare = comparer(input.locale);
  return selectableSuggestions(buildSuggestionGroups(input))
    .filter((s) => s.averageCents > 0)
    .sort(compare)
    .slice(0, limit);
}

/** Case-insensitive name search. A matching parent keeps all its subcategories. */
export function filterSuggestionGroups(groups: readonly SuggestionGroup[], query: string, locale: string): SuggestionGroup[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (needle === "") return [...groups];
  const matches = (s: Suggestion) => s.category.name.toLocaleLowerCase(locale).includes(needle);
  const result: SuggestionGroup[] = [];
  for (const group of groups) {
    if (matches(group.parent)) {
      result.push(group);
      continue;
    }
    const children = group.children.filter(matches);
    if (children.length > 0) result.push({ parent: group.parent, children });
  }
  return result;
}
