import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { isoDaysAgo } from "./dates";

// Seeds a bank connection straight into the database, for specs about what franC shows around a
// connection (status lines, the Import button, sync on open) rather than the connect flow, which
// e2e/bank-sync.spec.ts and e2e/bank-daily-sync.spec.ts walk through the fake bank. The fake
// serves the same transactions for any account uid, so a seeded link syncs like a real one.

export type SeededLink = { linkId: string; uid: string; accountId: string };

/**
 * One active connection with one imported link per franC account id. `lastSyncedAgo` is a Postgres
 * interval ("3 hours"), null for never. Returns the ids. Remove it with `deleteConnections`.
 */
export async function seedConnection(
  sql: postgres.Sql,
  userId: string,
  accountIds: string[],
  options: { lastSyncedAgo?: string | null; validForDays?: number } = {},
): Promise<{ connectionId: string; links: SeededLink[] }> {
  const { lastSyncedAgo = "10 minutes", validForDays = 60 } = options;
  const [connection] = await sql`
    insert into bank_connections (user_id, aspsp_name, aspsp_country, session_id, status, valid_until, connected_at)
    values (${userId}, 'Mock ASPSP', 'FR', ${`e2e-${randomUUID()}`}, 'active', now() + ${`${validForDays} days`}::interval, now())
    returning id`;
  const links: SeededLink[] = [];
  for (const accountId of accountIds) {
    const uid = randomUUID();
    const [link] = await sql`
      insert into bank_account_links (user_id, connection_id, bank_account_uid, display_name, iban_last4, account_id, linked_at, sync_from, last_synced_at)
      values (${userId}, ${connection.id}, ${uid}, 'Seeded account', '9999', ${accountId}, now(), ${isoDaysAgo(10)},
        ${lastSyncedAgo === null ? null : sql`now() - ${lastSyncedAgo}::interval`})
      returning id`;
    links.push({ linkId: link.id, uid, accountId });
  }
  return { connectionId: connection.id, links };
}

/** Removes the user's connections (their links cascade); accounts and transactions stay. */
export async function deleteConnections(sql: postgres.Sql, userId: string): Promise<void> {
  await sql`delete from bank_connections where user_id = ${userId}`;
}

/** A franC account the test owns; delete it with `deleteAccountById` (its transactions go with it). */
export async function seedAccount(sql: postgres.Sql, userId: string, name: string): Promise<string> {
  const [account] = await sql`insert into accounts (user_id, name) values (${userId}, ${name}) returning id`;
  return account.id;
}

export async function deleteAccountById(sql: postgres.Sql, accountId: string): Promise<void> {
  await sql`delete from accounts where id = ${accountId}`;
}

/** Makes the fake bank answer 429 (the daily limit) to the next transactions call for this bank account uid. */
export async function armRateLimit(uid: string): Promise<void> {
  const port = process.env.FAKE_EB_PORT ?? "3100";
  const res = await fetch(`http://localhost:${port}/control/rate-limit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uid }),
  });
  if (!res.ok) throw new Error(`fake bank refused the rate-limit control: ${res.status}`);
}
