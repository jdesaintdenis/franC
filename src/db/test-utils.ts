import { sql } from "drizzle-orm";

import { db } from "./client";
import { categories, users } from "./schema";

/**
 * Wipes every app table. Only for use in tests, against the test database
 * (vitest.setup.ts points DATABASE_URL at DATABASE_URL_TEST).
 */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      duplicate_candidates,
      backup_status,
      transaction_matches,
      transfer_rejections,
      transfers,
      transaction_splits,
      transactions,
      recurring_price_alerts,
      recurring,
      category_budgets,
      category_rules,
      categories,
      imports,
      accounts,
      sessions,
      auth_accounts,
      verifications,
      users
    RESTART IDENTITY CASCADE
  `);
}

let counter = 0;

export async function createTestUser(overrides?: {
  id?: string;
  email?: string;
  name?: string;
}): Promise<{ id: string; email: string; name: string }> {
  counter += 1;
  const id = overrides?.id ?? `test-user-${Date.now()}-${counter}`;
  const email = overrides?.email ?? `${id}@example.test`;
  const name = overrides?.name ?? "Test User";

  const [inserted] = await db
    .insert(users)
    .values({ id, email, name })
    .returning({ id: users.id, email: users.email, name: users.name });

  return inserted;
}

const TEST_CATEGORIES: ReadonlyArray<{ name: string; color: string }> = [
  { name: "Groceries", color: "#2E7D32" },
  { name: "Dining out", color: "#EF6C00" },
  { name: "Housing", color: "#6A1B9A" },
  { name: "Utilities & telecom", color: "#00838F" },
  { name: "Transport", color: "#1565C0" },
  { name: "Health", color: "#C2185B" },
  { name: "Shopping", color: "#AD1457" },
  { name: "Leisure", color: "#7B1FA2" },
  { name: "Subscriptions", color: "#5D4037" },
  { name: "Travel", color: "#00695C" },
  { name: "Cash withdrawal", color: "#616161" },
  { name: "Transfers", color: "#37474F" },
  { name: "Income", color: "#558B2F" },
  { name: "Fees & taxes", color: "#B71C1C" },
  { name: "Other", color: "#455A64" },
];

/**
 * Creates top-level categories for a test user (the app no longer seeds any).
 * Without `names`, creates the 15 categories older tests were written against.
 */
export async function seedCategories(userId: string, names?: readonly string[]): Promise<void> {
  const rows = names
    ? names.map((name, i) => ({ name, color: TEST_CATEGORIES[i % TEST_CATEGORIES.length].color }))
    : TEST_CATEGORIES;
  await db
    .insert(categories)
    .values(rows.map((r) => ({ userId, name: r.name, color: r.color })))
    .onConflictDoNothing();
}
