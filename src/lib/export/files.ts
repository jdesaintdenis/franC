import { centsToDecimal } from "./amount";
import { number, text, type CsvCell } from "./csv";
import { categoryCells } from "./transactions";

export const EXPORT_KINDS = ["transactions", "categories", "rules", "budgets"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const CATEGORY_COLUMNS = ["category", "subcategory", "color", "icon"] as const;
export const RULE_COLUMNS = ["priority", "matchType", "pattern", "category", "subcategory"] as const;
export const BUDGET_COLUMNS = ["category", "subcategory", "monthlyBudget", "rollover"] as const;

export type MatchTypeCode = "contains" | "equals" | "regex";

export interface RuleWords {
  matchType(code: MatchTypeCode): string;
}

/** Case- and accent-insensitive name order, the same for every locale so files compare. */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
}

export interface ExportCategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  icon: string | null;
}

/** Parents first (by name), each followed by its children (by name). */
export function categoryLines(rows: ExportCategoryRow[]): CsvCell[][] {
  const parents = rows.filter((r) => r.parentId === null).sort((a, b) => compareNames(a.name, b.name));
  const lines: CsvCell[][] = [];
  for (const parent of parents) {
    lines.push([text(parent.name), text(""), text(parent.color), text(parent.icon ?? "")]);
    const children = rows
      .filter((r) => r.parentId === parent.id)
      .sort((a, b) => compareNames(a.name, b.name));
    for (const child of children) {
      lines.push([text(parent.name), text(child.name), text(child.color), text(child.icon ?? "")]);
    }
  }
  return lines;
}

function categoryPair(name: string, parentName: string | null): [CsvCell, CsvCell] {
  return categoryCells({ name, parentName });
}

export interface ExportRuleRow {
  priority: number;
  matchType: MatchTypeCode;
  pattern: string;
  categoryName: string;
  parentName: string | null;
}

/** Keeps the given order: the caller passes rules in evaluation (priority) order. */
export function ruleLines(rows: ExportRuleRow[], words: RuleWords): CsvCell[][] {
  return rows.map((r) => [
    number(String(r.priority)),
    text(words.matchType(r.matchType)),
    text(r.pattern),
    ...categoryPair(r.categoryName, r.parentName),
  ]);
}

export interface ExportBudgetRow {
  categoryName: string;
  parentName: string | null;
  amountCents: number;
  rollover: boolean;
}

export interface BudgetWords {
  yesNo(value: boolean): string;
}

/** Ordered like the categories file: by category, then subcategory. */
export function budgetLines(rows: ExportBudgetRow[], separator: "." | ",", words: BudgetWords): CsvCell[][] {
  const key = (r: ExportBudgetRow) => [r.parentName ?? r.categoryName, r.parentName === null ? "" : r.categoryName];
  return [...rows]
    .sort((a, b) => {
      const [a1, a2] = key(a);
      const [b1, b2] = key(b);
      return compareNames(a1, b1) || compareNames(a2, b2);
    })
    .map((r) => [
      ...categoryPair(r.categoryName, r.parentName),
      number(centsToDecimal(r.amountCents, separator)),
      text(words.yesNo(r.rollover)),
    ]);
}
