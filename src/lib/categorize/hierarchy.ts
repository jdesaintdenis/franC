/**
 * Two-level category hierarchy: pure helpers, no DB and no user-facing text.
 * Callers translate the returned codes at the UI edge.
 */

import { withIcon } from "./icon";

export interface CategoryNode {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
  parentId: string | null;
}

export const CATEGORY_PATH_SEPARATOR = " > ";

export const HIERARCHY_CODES = [
  "parent_not_found",
  "parent_is_self",
  "parent_is_subcategory",
  "has_subcategories",
] as const;
export type HierarchyCode = (typeof HIERARCHY_CODES)[number];

export type ParentValidation = { ok: true } | { ok: false; code: HierarchyCode };

/**
 * Checks that `categoryId` (null for a category being created) may sit under
 * `parentId` (null = top level). Requiring the parent to be top-level and the
 * child to have no children of its own rules out cycles and depth > 2.
 */
export function validateParent(
  categories: readonly CategoryNode[],
  categoryId: string | null,
  parentId: string | null,
): ParentValidation {
  if (parentId === null) return { ok: true };
  if (categoryId !== null && parentId === categoryId) return { ok: false, code: "parent_is_self" };
  const parent = categories.find((c) => c.id === parentId);
  if (!parent) return { ok: false, code: "parent_not_found" };
  if (parent.parentId !== null) return { ok: false, code: "parent_is_subcategory" };
  if (categoryId !== null && categories.some((c) => c.parentId === categoryId)) {
    return { ok: false, code: "has_subcategories" };
  }
  return { ok: true };
}

export interface CategoryTreeNode<T extends CategoryNode = CategoryNode> {
  category: T;
  children: T[];
}

function byName(locale: string) {
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);
}

/** Parents sorted by name, each with sorted children. Orphans count as top-level. */
export function buildCategoryTree<T extends CategoryNode>(
  categories: readonly T[],
  locale: string,
): CategoryTreeNode<T>[] {
  const ids = new Set(categories.map((c) => c.id));
  const compare = byName(locale);
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const category of categories) {
    if (category.parentId !== null && ids.has(category.parentId)) {
      const list = childrenOf.get(category.parentId) ?? [];
      list.push(category);
      childrenOf.set(category.parentId, list);
    } else {
      roots.push(category);
    }
  }
  return [...roots].sort(compare).map((category) => ({
    category,
    children: [...(childrenOf.get(category.id) ?? [])].sort(compare),
  }));
}

export interface CategoryOption {
  id: string;
  name: string;
  color: string;
  /** The category's own icon, subcategories included (SPEC §66). */
  icon: string | null;
  parentId: string | null;
  parentName: string | null;
  /**
   * "🏠 Housing > 🛋️ Furniture" for subcategories, "🏠 Housing" otherwise. A native option
   * can't hold a colour dot, so a category without an icon shows its name alone. Each part
   * carries its own emoji when it has one.
   */
  label: string;
}

/** Flat picker options in tree order: each parent followed by its children. */
export function orderedCategoryOptions(
  categories: readonly CategoryNode[],
  locale: string,
): CategoryOption[] {
  const options: CategoryOption[] = [];
  for (const { category, children } of buildCategoryTree(categories, locale)) {
    options.push({
      id: category.id,
      name: category.name,
      color: category.color,
      icon: category.icon ?? null,
      // An orphan keeps its dangling parentId out of the label.
      parentId: null,
      parentName: null,
      label: withIcon(category.icon, category.name),
    });
    for (const child of children) {
      options.push({
        id: child.id,
        name: child.name,
        color: child.color,
        icon: child.icon ?? null,
        parentId: category.id,
        parentName: category.name,
        label: `${withIcon(category.icon, category.name)}${CATEGORY_PATH_SEPARATOR}${withIcon(child.icon, child.name)}`,
      });
    }
  }
  return options;
}

/** The category plus its direct children: what filtering on a parent covers. */
export function coveredCategoryIds(categories: readonly CategoryNode[], id: string): string[] {
  return [id, ...categories.filter((c) => c.parentId === id).map((c) => c.id)];
}
