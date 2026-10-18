export interface RuleView {
  id: string;
  categoryId: string;
  categoryName: string;
  /** Path label such as "Housing > Furniture"; the plain name for top-level categories. */
  categoryLabel: string;
  categoryColor: string;
  /** A top-level category's own icon; null for a subcategory. */
  categoryIcon: string | null;
  matchType: "contains" | "equals" | "regex";
  pattern: string;
}

export interface CategoryOption {
  id: string;
  /** Path label in tree order. */
  label: string;
}
