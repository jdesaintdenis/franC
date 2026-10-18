/**
 * Bank categories (Slice 14): pure logic, no DB and no user-facing text.
 *
 * The bank's own category/subcategory (already cleaned by `cleanBankCategory`)
 * are mapped by the user to their own categories. A mapping is stored per bank
 * category, or per bank subcategory; a null target means "Ignored".
 */

import { nextCategoryColor, subcategoryShade } from "@/lib/category-color";
import { bankCategoryIcon } from "./bank-icons";

export interface BankRow {
  bankCategory: string | null;
  bankSubcategory: string | null;
}

export interface BankMapping {
  bankCategory: string;
  /** Null = the mapping of the bank category itself. */
  bankSubcategory: string | null;
  /** Null = Ignored. */
  categoryId: string | null;
}

/** Stored mappings by `bankKey`; a null value means Ignored. */
export type BankMappingLookup = ReadonlyMap<string, string | null>;

export interface BankCategoryOption {
  id: string;
  name: string;
  parentId: string | null;
  /** Used to pick distinct colours for created categories; absent = unknown. */
  color?: string;
}

/** Stable identity of a bank category (subcategory null) or subcategory. */
export function bankKey(category: string, subcategory: string | null): string {
  return JSON.stringify([category, subcategory]);
}

export function buildMappingLookup(mappings: readonly BankMapping[]): BankMappingLookup {
  return new Map(mappings.map((m) => [bankKey(m.bankCategory, m.bankSubcategory), m.categoryId]));
}

/**
 * The category a row gets from the bank's categories: the subcategory's
 * mapping if it maps to a category, else the bank category's own mapping,
 * else null. So "Ignore" on a subcategory falls back to its parent's mapping.
 */
export function resolveBankCategory(row: BankRow, mappings: BankMappingLookup): string | null {
  if (row.bankCategory === null) return null;
  if (row.bankSubcategory !== null) {
    const own = mappings.get(bankKey(row.bankCategory, row.bankSubcategory));
    if (own != null) return own;
  }
  return mappings.get(bankKey(row.bankCategory, null)) ?? null;
}

// ---------------------------------------------------------------- planning

export interface BankPlanItem {
  key: string;
  bankCategory: string;
  bankSubcategory: string | null;
  /** Rows in the file (all valid rows, duplicates included) with this category/subcategory. */
  rowCount: number;
  /** An existing category with the same name at the matching place, else null. */
  suggestedCategoryId: string | null;
}

export interface BankPlanGroup {
  bankCategory: string;
  /** Rows in the file under this bank category, whatever their subcategory. */
  rowCount: number;
  /** True when the bank category already has a stored mapping (possibly Ignored). */
  decided: boolean;
  /** The stored target when `decided` (null = Ignored). */
  storedCategoryId: string | null;
  /** The bank category itself; null when `decided`. */
  category: BankPlanItem | null;
  /** Subcategories without a stored mapping. */
  subcategories: BankPlanItem[];
}

export interface BankPlan {
  groups: BankPlanGroup[];
}

const collator = new Intl.Collator("fr", { sensitivity: "base" });
const byName = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function findByName(
  categories: readonly BankCategoryOption[],
  name: string,
  parentId: string | null,
): BankCategoryOption | undefined {
  return categories.find((c) => c.parentId === parentId && sameName(c.name, name));
}

/**
 * Where subcategories of a category with this target live: the target itself
 * when top-level, else its parent (two levels max). Null = top level.
 */
function placeUnder(categories: readonly BankCategoryOption[], targetId: string | null): string | null {
  if (targetId === null) return null;
  const target = categories.find((c) => c.id === targetId);
  if (!target) return null;
  return target.parentId ?? target.id;
}

/**
 * The items to ask the user about, grouped by bank category (sorted by name,
 * fr collation). A bank category with a stored mapping only lists its
 * unmapped subcategories. Fully mapped groups are omitted.
 *
 * Suggestions: a bank category is suggested a top-level category of the same
 * name (case-insensitive); a subcategory one of the same name under the
 * group's target (stored target, else the suggestion for the bank category;
 * top level when there is none).
 */
export function planBankCategories(
  rows: readonly BankRow[],
  mappings: BankMappingLookup,
  categories: readonly BankCategoryOption[],
): BankPlan {
  const byCategory = new Map<string, { total: number; subs: Map<string, number> }>();
  for (const row of rows) {
    if (row.bankCategory === null) continue;
    const entry = byCategory.get(row.bankCategory) ?? { total: 0, subs: new Map<string, number>() };
    entry.total += 1;
    if (row.bankSubcategory !== null) {
      entry.subs.set(row.bankSubcategory, (entry.subs.get(row.bankSubcategory) ?? 0) + 1);
    }
    byCategory.set(row.bankCategory, entry);
  }

  const groups: BankPlanGroup[] = [];
  for (const name of [...byCategory.keys()].sort(byName)) {
    const entry = byCategory.get(name)!;
    const categoryKey = bankKey(name, null);
    const decided = mappings.has(categoryKey);
    const storedCategoryId = decided ? (mappings.get(categoryKey) ?? null) : null;
    const suggested = decided ? null : (findByName(categories, name, null)?.id ?? null);
    const category: BankPlanItem | null = decided
      ? null
      : { key: categoryKey, bankCategory: name, bankSubcategory: null, rowCount: entry.total, suggestedCategoryId: suggested };

    const place = placeUnder(categories, decided ? storedCategoryId : suggested);
    const subcategories = [...entry.subs.keys()]
      .sort(byName)
      .filter((sub) => !mappings.has(bankKey(name, sub)))
      .map((sub) => ({
        key: bankKey(name, sub),
        bankCategory: name,
        bankSubcategory: sub,
        rowCount: entry.subs.get(sub)!,
        suggestedCategoryId: findByName(categories, sub, place)?.id ?? null,
      }));

    if (category === null && subcategories.length === 0) continue;
    groups.push({ bankCategory: name, rowCount: entry.total, decided, storedCategoryId, category, subcategories });
  }
  return { groups };
}

// ------------------------------------------------------------------ writes

export type BankDecision =
  | { action: "create" }
  | { action: "map"; categoryId: string }
  | { action: "ignore" };

/** Keyed by `BankPlanItem.key`; absent = undecided. */
export type BankDecisions = Readonly<Record<string, BankDecision | undefined>>;

export interface CategoryToCreate {
  /** Referenced by mappings and by children's `parentKey`. */
  createKey: string;
  name: string;
  /** Existing parent (subcategory under an existing category), else null. */
  parentId: string | null;
  /** Parent created in the same batch; always listed earlier. */
  parentKey: string | null;
  color: string;
  /** Default emoji for known top-level bank names (subcategories start without one; they can get their own, SPEC §66). */
  icon: string | null;
}

export type MappingTarget =
  | { kind: "category"; categoryId: string }
  | { kind: "created"; createKey: string }
  | { kind: "ignored" };

export interface MappingToStore {
  bankCategory: string;
  bankSubcategory: string | null;
  target: MappingTarget;
}

export interface BankCategoryWrites {
  /** Parents first. */
  create: CategoryToCreate[];
  mappings: MappingToStore[];
}

export type BankWritesResult =
  | { ok: true; writes: BankCategoryWrites }
  | { ok: false; code: "category_not_found" };

/** Where the subcategories of a group go: an existing place or a category being created. */
type Place = { parentId: string | null; parentKey: string | null };

const TOP_LEVEL: Place = { parentId: null, parentKey: null };

const isTopLevel = (place: Place): boolean => place.parentId === null && place.parentKey === null;

/**
 * Turns the user's decisions into categories to create and mappings to store.
 * Undecided items and decisions for keys outside the plan produce nothing.
 * A name that already exists at the target place is reused, not created.
 * Mapped ids must belong to `categories` (the user's own list).
 */
export function buildBankCategoryWrites(
  plan: BankPlan,
  decisions: BankDecisions,
  categories: readonly BankCategoryOption[],
): BankWritesResult {
  const create: CategoryToCreate[] = [];
  const mappings: MappingToStore[] = [];
  const createdByPlace = new Map<string, string>();
  const known = new Set(categories.map((c) => c.id));
  const usedTopColors = categories.filter((c) => c.parentId === null && c.color).map((c) => c.color as string);

  /** Top-level: the next unused palette colour. Subcategory: a shade of its parent's colour. */
  const colorFor = (place: Place): string => {
    if (isTopLevel(place)) {
      const color = nextCategoryColor(usedTopColors);
      usedTopColors.push(color);
      return color;
    }
    const parentColor =
      place.parentKey !== null
        ? create.find((c) => c.createKey === place.parentKey)?.color
        : categories.find((c) => c.id === place.parentId)?.color;
    const siblings =
      categories.filter((c) => place.parentId !== null && c.parentId === place.parentId).length +
      create.filter((c) => c.parentId === place.parentId && c.parentKey === place.parentKey).length;
    return subcategoryShade(parentColor ?? nextCategoryColor(usedTopColors), siblings);
  };

  const decisionFor = (key: string): BankDecision | undefined =>
    Object.hasOwn(decisions, key) ? decisions[key] : undefined;

  /** Existing category with that name at the place, or a new one to create. */
  const createOrReuse = (item: BankPlanItem, place: Place): MappingTarget => {
    const name = (item.bankSubcategory ?? item.bankCategory).trim();
    if (place.parentKey === null) {
      const existing = findByName(categories, name, place.parentId);
      if (existing) return { kind: "category", categoryId: existing.id };
    }
    const placeKey = `${place.parentId ?? place.parentKey ?? ""}\u0000${name.toLowerCase()}`;
    const already = createdByPlace.get(placeKey);
    if (already !== undefined) return { kind: "created", createKey: already };
    create.push({
      createKey: item.key,
      name,
      parentId: place.parentId,
      parentKey: place.parentKey,
      color: colorFor(place),
      icon: isTopLevel(place) ? bankCategoryIcon(name) : null,
    });
    createdByPlace.set(placeKey, item.key);
    return { kind: "created", createKey: item.key };
  };

  /** Null = the decision doesn't map to a valid target (invalid id). */
  const targetFor = (item: BankPlanItem, decision: BankDecision, place: Place): MappingTarget | null => {
    if (decision.action === "ignore") return { kind: "ignored" };
    if (decision.action === "map") {
      return known.has(decision.categoryId) ? { kind: "category", categoryId: decision.categoryId } : null;
    }
    return createOrReuse(item, place);
  };

  for (const group of plan.groups) {
    // The target of the bank category decides where its subcategories are created.
    let groupTarget: MappingTarget = group.decided
      ? group.storedCategoryId === null
        ? { kind: "ignored" }
        : { kind: "category", categoryId: group.storedCategoryId }
      : { kind: "ignored" };

    if (group.category) {
      const decision = decisionFor(group.category.key);
      if (decision) {
        const target = targetFor(group.category, decision, TOP_LEVEL);
        if (target === null) return { ok: false, code: "category_not_found" };
        groupTarget = target;
        mappings.push({ bankCategory: group.bankCategory, bankSubcategory: null, target });
      }
    }

    let place = TOP_LEVEL;
    if (groupTarget.kind === "created") place = { parentId: null, parentKey: groupTarget.createKey };
    else if (groupTarget.kind === "category") {
      place = { parentId: placeUnder(categories, groupTarget.categoryId), parentKey: null };
    }

    for (const sub of group.subcategories) {
      const decision = decisionFor(sub.key);
      if (!decision) continue;
      const target = targetFor(sub, decision, place);
      if (target === null) return { ok: false, code: "category_not_found" };
      mappings.push({ bankCategory: group.bankCategory, bankSubcategory: sub.bankSubcategory, target });
    }
  }
  return { ok: true, writes: { create, mappings } };
}
