import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { bankCategoryMappings, categories, categoryRules, merchants, tags } from "../schema";

export interface ManageCounts {
  topCategories: number;
  subCategories: number;
  rules: number;
  merchants: number;
  tags: number;
  bankMappings: number;
}

const n = sql<number>`count(*)::int`;

/** What the Plus page shows on the right of each row. Every count is scoped by user_id. */
export async function getManageCounts(database: typeof dbClient, userId: string): Promise<ManageCounts> {
  const [[top], [sub], [rules], [merchantRows], [tagRows], [mappings]] = await Promise.all([
    database.select({ n }).from(categories).where(and(eq(categories.userId, userId), isNull(categories.parentId))),
    database.select({ n }).from(categories).where(and(eq(categories.userId, userId), isNotNull(categories.parentId))),
    database.select({ n }).from(categoryRules).where(eq(categoryRules.userId, userId)),
    database.select({ n }).from(merchants).where(eq(merchants.userId, userId)),
    database.select({ n }).from(tags).where(eq(tags.userId, userId)),
    database.select({ n }).from(bankCategoryMappings).where(eq(bankCategoryMappings.userId, userId)),
  ]);
  return {
    topCategories: top?.n ?? 0,
    subCategories: sub?.n ?? 0,
    rules: rules?.n ?? 0,
    merchants: merchantRows?.n ?? 0,
    tags: tagRows?.n ?? 0,
    bankMappings: mappings?.n ?? 0,
  };
}
