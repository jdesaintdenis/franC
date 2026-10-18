import { expect, type Page } from "@playwright/test";
import type postgres from "postgres";

import type { E2EUser } from "../fixtures";

/**
 * Empties the worker user's review queue. Mark all leaves rows without a category (SPEC §73 A),
 * so the specs that need an empty queue mark the rows in the database instead.
 */
export async function clearQueue(page: Page, sql: postgres.Sql, user: E2EUser) {
  await sql`update transactions set reviewed_at = now() where user_id = ${user.id} and reviewed_at is null`;
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "All caught up" })).toBeVisible();
}

/**
 * Gives every row still waiting in the user's queue a hand-chosen category, so "Reviewed" works on
 * it (a row without a category cannot be validated, SPEC §73 A).
 */
export async function categorizeWaiting(sql: postgres.Sql, user: E2EUser) {
  const name = "E2E Queue";
  await sql`
    insert into categories (user_id, name, color) values (${user.id}, ${name}, '#336699')
    on conflict do nothing`;
  await sql`
    update transactions
    set category_id = (select id from categories where user_id = ${user.id} and name = ${name} and parent_id is null),
        category_source = 'manual'
    where user_id = ${user.id} and reviewed_at is null and category_id is null`;
}
