import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { ExportBudgetRow, ExportCategoryRow, ExportRuleRow } from "../../lib/export/files";
import type { ExportPart, ExportTransaction } from "../../lib/export/transactions";
import type { TransactionFilters } from "../../lib/transactions/filters";
import type { db as dbClient } from "../client";
import { accounts, categories, categoryBudgets, categoryRules, merchants, transactions, transactionSplits } from "../schema";
import { loadTransactionTags } from "./tags";
import { buildWhere, loadTransferInfo } from "./transactions";

const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface PartRow {
  part: ExportPart;
  categoryId: string | null;
  parentId: string | null;
}

/** All parts of the given transactions by position (scoped by user_id, chunked id lists). */
async function loadParts(
  database: typeof dbClient,
  userId: string,
  ids: string[],
): Promise<Map<string, PartRow[]>> {
  const result = new Map<string, PartRow[]>();
  const parent = alias(categories, "parent_category");
  for (const idChunk of chunk(ids, CHUNK_SIZE)) {
    const rows = await database
      .select({
        transactionId: transactionSplits.transactionId,
        amountCents: transactionSplits.amountCents,
        categoryId: categories.id,
        parentId: categories.parentId,
        categoryName: categories.name,
        parentName: parent.name,
      })
      .from(transactionSplits)
      .leftJoin(categories, and(eq(categories.id, transactionSplits.categoryId), eq(categories.userId, userId)))
      .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
      .where(and(eq(transactionSplits.userId, userId), inArray(transactionSplits.transactionId, idChunk)))
      .orderBy(asc(transactionSplits.transactionId), asc(transactionSplits.position));
    for (const r of rows) {
      const list = result.get(r.transactionId) ?? [];
      list.push({
        part: {
          number: list.length + 1,
          category: r.categoryName === null ? null : { name: r.categoryName, parentName: r.parentName },
          amountCents: r.amountCents,
        },
        categoryId: r.categoryId,
        parentId: r.parentId,
      });
      result.set(r.transactionId, list);
    }
  }
  return result;
}

/** Whether a part falls under the page's category filter (a parent covers its children). */
function partMatches(p: PartRow, category: string | undefined): boolean {
  if (category === undefined) return true;
  if (category === "none") return p.categoryId === null;
  return p.categoryId === category || p.parentId === category;
}

/**
 * Every transaction matching the Transactions page's filters (same `buildWhere`), oldest
 * first. A split row carries its parts; under a category filter only the matching ones, but
 * numbered among all of them. Everything is scoped by user_id.
 */
export async function exportTransactions(
  database: typeof dbClient,
  userId: string,
  filters: TransactionFilters,
): Promise<ExportTransaction[]> {
  const parent = alias(categories, "parent_category");
  const rows = await database
    .select({
      id: transactions.id,
      date: transactions.date,
      amountCents: transactions.amountCents,
      labelDisplay: transactions.labelDisplay,
      labelRaw: transactions.labelRaw,
      note: transactions.note,
      merchantName: merchants.name,
      accountName: accounts.name,
      categorySource: transactions.categorySource,
      bankCategory: transactions.bankCategory,
      bankSubcategory: transactions.bankSubcategory,
      categoryName: categories.name,
      parentName: parent.name,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, userId)))
    .leftJoin(categories, and(eq(categories.id, transactions.categoryId), eq(categories.userId, userId)))
    .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
    .leftJoin(merchants, and(eq(merchants.id, transactions.merchantId), eq(merchants.userId, userId)))
    .where(buildWhere(userId, filters, null))
    .orderBy(asc(transactions.date), asc(transactions.id));

  const ids = rows.map((r) => r.id);
  const parts = await loadParts(database, userId, ids);
  const tagsByTx = new Map<string, string[]>();
  for (const idChunk of chunk(ids, CHUNK_SIZE)) {
    for (const [id, list] of await loadTransactionTags(database, userId, idChunk)) {
      tagsByTx.set(id, list.map((t) => t.name));
    }
  }
  const transferByTx = new Map<string, string>();
  for (const idChunk of chunk(ids, CHUNK_SIZE)) {
    const found = await loadTransferInfo(database, userId, idChunk);
    for (const [id, info] of found) transferByTx.set(id, info.counterpartAccountName);
  }

  return rows.map((r) => {
    const all = parts.get(r.id);
    return {
      date: r.date,
      accountName: r.accountName,
      merchantName: r.merchantName,
      labelDisplay: r.labelDisplay,
      labelRaw: r.labelRaw,
      amountCents: r.amountCents,
      category: r.categoryName === null ? null : { name: r.categoryName, parentName: r.parentName },
      categorySource: r.categorySource,
      bankCategory: r.bankCategory,
      bankSubcategory: r.bankSubcategory,
      transferAccountName: transferByTx.get(r.id) ?? null,
      tags: tagsByTx.get(r.id) ?? [],
      note: r.note,
      split: all
        ? { total: all.length, parts: all.filter((p) => partMatches(p, filters.category)).map((p) => p.part) }
        : null,
    };
  });
}

export async function exportCategories(database: typeof dbClient, userId: string): Promise<ExportCategoryRow[]> {
  return database
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      color: categories.color,
      icon: categories.icon,
    })
    .from(categories)
    .where(eq(categories.userId, userId));
}

/** In evaluation order (same ordering as `listRules`), scoped by user_id. */
export async function exportRules(database: typeof dbClient, userId: string): Promise<ExportRuleRow[]> {
  const parent = alias(categories, "parent_category");
  return database
    .select({
      priority: categoryRules.priority,
      matchType: categoryRules.matchType,
      pattern: categoryRules.pattern,
      categoryName: categories.name,
      parentName: parent.name,
    })
    .from(categoryRules)
    .innerJoin(categories, and(eq(categories.id, categoryRules.categoryId), eq(categories.userId, userId)))
    .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
    .where(eq(categoryRules.userId, userId))
    .orderBy(asc(categoryRules.priority), asc(categoryRules.createdAt), asc(categoryRules.id));
}

export async function exportBudgets(database: typeof dbClient, userId: string): Promise<ExportBudgetRow[]> {
  const parent = alias(categories, "parent_category");
  return database
    .select({
      categoryName: categories.name,
      parentName: parent.name,
      amountCents: categoryBudgets.amountCents,
      rollover: categoryBudgets.rollover,
    })
    .from(categoryBudgets)
    .innerJoin(categories, and(eq(categories.id, categoryBudgets.categoryId), eq(categories.userId, userId)))
    .leftJoin(parent, and(eq(parent.id, categories.parentId), eq(parent.userId, userId)))
    .where(eq(categoryBudgets.userId, userId));
}
