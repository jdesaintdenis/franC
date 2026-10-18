import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import type { Sql, TransactionSql } from "postgres";

import type { BackupArchive } from "@/lib/backup/archive";

export type RestoreErrorCode = "migrations" | "not-empty" | "schema" | "count";

/** The message names tables and counts only, never row data. */
export class RestoreError extends Error {
  constructor(
    readonly code: RestoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RestoreError";
  }
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

async function publicTables(sql: Sql | TransactionSql): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    select table_name as name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name`;
  return rows.map((r) => r.name);
}

async function migrationMarker(sql: Sql | TransactionSql): Promise<BackupArchive["migrations"]> {
  const [exists] = await sql<{ ok: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as ok`;
  if (!exists.ok) return { count: 0, lastHash: null };
  const [row] = await sql<{ count: number; lastHash: string | null }[]>`
    select count(*)::int as count,
           (select hash from drizzle.__drizzle_migrations order by created_at desc limit 1) as "lastHash"
    from drizzle.__drizzle_migrations`;
  return { count: row.count, lastHash: row.lastHash };
}

/**
 * Runs `work` inside a repeatable-read, READ ONLY transaction: one consistent snapshot, and Postgres
 * itself rejects any write, whatever role the connection uses.
 */
export function inReadOnlySnapshot<T>(sql: Sql, work: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin("isolation level repeatable read read only", work) as Promise<T>;
}

async function readCopy(tx: TransactionSql, table: string, columns: string[]): Promise<string> {
  const stream = await tx
    .unsafe(`copy ${quote(table)} (${columns.map(quote).join(", ")}) to stdout`)
    .readable();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function dumpDatabase(sql: Sql, now: () => Date = () => new Date()): Promise<BackupArchive> {
  return inReadOnlySnapshot(sql, async (tx) => {
    const tables: BackupArchive["tables"] = [];
    for (const name of await publicTables(tx)) {
      const columns = (
        await tx<{ name: string }[]>`
          select column_name as name from information_schema.columns
          where table_schema = 'public' and table_name = ${name} and is_generated = 'NEVER'
          order by ordinal_position`
      ).map((c) => c.name);
      const [{ count }] = await tx.unsafe<{ count: number }[]>(`select count(*)::int as count from ${quote(name)}`);
      // shortcut: the whole dump is held in memory (a few MB today); stream table by table if it nears the function's memory.
      tables.push({ name, columns, rowCount: count, copy: await readCopy(tx, name, columns) });
    }
    return {
      format: "franc-backup" as const,
      version: 1 as const,
      createdAt: now().toISOString(),
      migrations: await migrationMarker(tx),
      tables,
    };
  });
}

/** Name of the first public table that holds a row, or null when all are empty (a new database has no tables at all). */
export async function firstFilledTable(sql: Sql | TransactionSql): Promise<string | null> {
  for (const name of await publicTables(sql)) {
    const [row] = await sql.unsafe<{ has: boolean }[]>(`select exists(select 1 from ${quote(name)}) as has`);
    if (row.has) return name;
  }
  return null;
}

/**
 * Loads an archive into an empty database of the same migration level, in one transaction.
 * Foreign keys are dropped while loading and re-added (and re-validated) after: users and
 * accounts reference each other, so no table order would work.
 */
export async function restoreDatabase(
  sql: Sql,
  archive: BackupArchive,
): Promise<{ table: string; rows: number }[]> {
  return sql.begin(async (tx) => {
    const marker = await migrationMarker(tx);
    if (marker.count !== archive.migrations.count || marker.lastHash !== archive.migrations.lastHash) {
      throw new RestoreError(
        "migrations",
        `backup has ${archive.migrations.count} migrations, this database ${marker.count}`,
      );
    }
    const filled = await firstFilledTable(tx);
    if (filled) throw new RestoreError("not-empty", `table ${filled} has rows`);

    const existing = new Set(await publicTables(tx));
    for (const table of archive.tables) {
      const present = new Set(
        (
          await tx<{ name: string }[]>`
            select column_name as name from information_schema.columns
            where table_schema = 'public' and table_name = ${table.name}`
        ).map((c) => c.name),
      );
      if (!existing.has(table.name) || table.columns.some((c) => !present.has(c))) {
        throw new RestoreError("schema", `table ${table.name} does not match the backup`);
      }
    }

    const fks = await tx<{ table: string; name: string; def: string }[]>`
      select conrelid::regclass::text as "table", conname as name, pg_get_constraintdef(oid) as def
      from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`;
    for (const fk of fks) await tx.unsafe(`alter table ${fk.table} drop constraint ${quote(fk.name)}`);

    const restored: { table: string; rows: number }[] = [];
    for (const table of archive.tables) {
      const sink = await tx
        .unsafe(`copy ${quote(table.name)} (${table.columns.map(quote).join(", ")}) from stdin`)
        .writable();
      await pipeline(Readable.from([Buffer.from(table.copy, "utf8")]), sink);
      const [{ count }] = await tx.unsafe<{ count: number }[]>(
        `select count(*)::int as count from ${quote(table.name)}`,
      );
      if (count !== table.rowCount) {
        throw new RestoreError("count", `table ${table.name} has ${count} rows, the backup ${table.rowCount}`);
      }
      restored.push({ table: table.name, rows: count });
    }

    for (const fk of fks) await tx.unsafe(`alter table ${fk.table} add constraint ${quote(fk.name)} ${fk.def}`);
    return restored;
  }) as Promise<{ table: string; rows: number }[]>;
}
