// @vitest-environment node
import { generateIdentity, identityToRecipient } from "age-encryption";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { decryptBackup, encryptBackup, packArchive, unpackArchive } from "@/lib/backup/archive";

import { dumpDatabase, inReadOnlySnapshot, firstFilledTable, restoreDatabase, RestoreError } from "./backup";
import { db } from "./client";
import { accounts, categories, imports, transactions, users } from "./schema";
import { createTestUser, resetDb, seedCategories } from "./test-utils";

// vitest.setup.ts points DATABASE_URL at the test database; this is a second connection to it.
const raw = postgres(process.env.DATABASE_URL as string, { max: 2 });
afterAll(() => raw.end());

const PUBLIC_TABLES = sql`
  select table_name as name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`;

/** Every public table as JSON, in a stable order, to compare before and after. */
async function snapshot(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  const names = (await db.execute<{ name: string }>(PUBLIC_TABLES)).map((r) => r.name);
  for (const name of names) {
    out[name] = await raw.unsafe(`select * from "${name}" order by to_jsonb("${name}")::text`);
  }
  return JSON.parse(JSON.stringify(out));
}

const fkCount = async () =>
  (await raw<{ n: number }[]>`select count(*)::int as n from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`)[0].n;

async function seed() {
  const user = await createTestUser();
  await seedCategories(user.id);
  const [account] = await db.insert(accounts).values({ userId: user.id, name: "Main" }).returning();
  // users -> accounts and accounts -> users: the foreign-key cycle a restore must survive.
  await db.update(users).set({ homeAccountId: account.id }).where(eq(users.id, user.id));
  const [parent] = await db.select().from(categories).where(eq(categories.userId, user.id)).limit(1);
  await db.insert(categories).values({ userId: user.id, name: "Sub", color: "#112233", parentId: parent.id });
  const [imp] = await db.insert(imports).values({ userId: user.id, accountId: account.id, filename: "x", rowsTotal: 2, rowsError: 0 }).returning();
  await db.insert(transactions).values([
    { userId: user.id, accountId: account.id, importId: imp.id, date: "2026-10-01", amountCents: -1250, labelRaw: "a\tb\\c\nd", labelNormalized: "A", labelDisplay: "A", dedupeHash: "h1", occurrenceIndex: 0 },
    { userId: user.id, accountId: account.id, importId: imp.id, date: "2026-10-02", amountCents: 500000, labelRaw: "Salary", labelNormalized: "S", labelDisplay: "S", dedupeHash: "h2", occurrenceIndex: 0 },
  ]);
}

describe("backup round trip", () => {
  beforeEach(resetDb);

  it("dumps, encrypts, decrypts and restores into an emptied database with nothing lost", async () => {
    await seed();
    const before = await snapshot();
    const fks = await fkCount();

    const identity = await generateIdentity();
    const recipient = await identityToRecipient(identity);
    const archive = await dumpDatabase(raw);
    const file = await encryptBackup(packArchive(archive), recipient);
    const back = unpackArchive(await decryptBackup(file, identity));
    expect(back.tables.find((t) => t.name === "transactions")?.rowCount).toBe(2);

    await resetDb();
    expect(await firstFilledTable(raw)).toBeNull();
    const restored = await restoreDatabase(raw, back);

    expect(restored.find((r) => r.table === "transactions")?.rows).toBe(2);
    expect(await snapshot()).toEqual(before);
    expect(await fkCount()).toBe(fks);
  });

  it("refuses a database that already has rows and changes nothing", async () => {
    await seed();
    const archive = await dumpDatabase(raw);
    const before = await snapshot();
    await expect(restoreDatabase(raw, archive)).rejects.toMatchObject({ code: "not-empty" });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a backup made at another migration level", async () => {
    const archive = await dumpDatabase(raw);
    const other = { ...archive, migrations: { ...archive.migrations, count: archive.migrations.count + 1 } };
    await expect(restoreDatabase(raw, other)).rejects.toBeInstanceOf(RestoreError);
    await expect(restoreDatabase(raw, other)).rejects.toMatchObject({ code: "migrations" });
  });

  it("cannot write while dumping: Postgres rejects it (25006)", async () => {
    await expect(
      inReadOnlySnapshot(raw, (tx) => tx`insert into backup_status (id, last_attempt_at) values (1, now())`),
    ).rejects.toMatchObject({ code: "25006" });
  });
});
