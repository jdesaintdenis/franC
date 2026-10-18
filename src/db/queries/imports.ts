import { and, count, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";

import type { db as dbClient } from "../client";
import { buildMappingLookup, resolveBankCategory, type BankCategoryWrites } from "../../lib/categorize/bank";
import { categorizeLabel } from "../../lib/categorize/rules";
import {
  MATCH_WINDOW_DAYS,
  matchIncoming,
  type Decision,
  type Existing,
  type MatchedIdentity,
  type Side,
} from "../../lib/bank-sync/match";
import { dedupeKey } from "../../lib/import/dedupe";
import type { KeyedTransaction } from "../../lib/import/types";
import { resolveMerchant } from "../../lib/merchants/match";
import { addDays } from "../../lib/recurring/dates";
import {
  accounts,
  duplicateCandidates,
  imports,
  transactionMatches,
  transactions,
  type Import,
} from "../schema";

// "franc" imports are hidden holders of rows franC creates (Slice 52); no import or sync run has that kind.
export type ImportKind = Exclude<Import["kind"], "franc">;
/** A row to insert: CSV rows have no bank id; synced rows may. */
export type ImportRow = KeyedTransaction & { externalId?: string | null };
import { applyBankCategoryWrites, applyBankMappings, loadBankMappings } from "./bank-categories";
import { loadCompiledRules } from "./category-rules";
import { guessInTransaction } from "./guess";
import { loadMerchantLookup } from "./merchants";

const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Keys (`hash:index`) of stored transactions for this user+account matching any of `hashes`. */
export async function loadExistingDedupeKeys(
  database: typeof dbClient,
  userId: string,
  accountId: string,
  hashes: string[],
): Promise<Set<string>> {
  const keys = new Set<string>();
  const unique = [...new Set(hashes)];
  for (const part of chunk(unique, CHUNK_SIZE)) {
    const rows = await database
      .select({ dedupeHash: transactions.dedupeHash, occurrenceIndex: transactions.occurrenceIndex })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.accountId, accountId),
          inArray(transactions.dedupeHash, part),
        ),
      );
    for (const row of rows) keys.add(dedupeKey(row));
  }
  return keys;
}

export type MatchCounts = { insert: number; duplicate: number; merge: number; possible: number; adopt: number };

/**
 * Read-only: decides what each row would become (new, already known, merged into a row of the other
 * side, or a possible duplicate) without writing anything. `commitImport` runs it inside its
 * transaction and the CSV preview runs it on its own, so both show the same numbers.
 *
 * Loads the account's rows dated within the matching window of the batch, plus any row or merged
 * identity the batch's hashes and bank ids point to, wherever its date is (the exact passes must see
 * the whole account). Scoped by user and account.
 */
export async function planMatches(
  database: Pick<typeof dbClient, "select">,
  userId: string,
  accountId: string,
  side: Side,
  rows: readonly ImportRow[],
): Promise<{ decisions: Decision[]; counts: MatchCounts }> {
  const counts: MatchCounts = { insert: 0, duplicate: 0, merge: 0, possible: 0, adopt: 0 };
  if (rows.length === 0) return { decisions: [], counts };

  const owned = and(eq(transactions.userId, userId), eq(transactions.accountId, accountId));
  const columns = {
    id: transactions.id,
    date: transactions.date,
    amountCents: transactions.amountCents,
    // "franc" rows live on Savings accounts, which take no imports; both they and hand-added rows
    // are never candidates of the other side (only waiting hand rows can be adopted).
    source: sql<"csv" | "sync" | "manual">`case when ${transactions.source} in ('franc', 'manual') then 'manual' else ${transactions.source}::text end`,
    awaitingBank: transactions.awaitingBank,
    externalId: transactions.externalId,
    dedupeHash: transactions.dedupeHash,
    occurrenceIndex: transactions.occurrenceIndex,
  };
  const found = new Map<string, Omit<Existing, "matched">>();
  const remember = (list: Array<Omit<Existing, "matched">>) => {
    for (const r of list) found.set(r.id, r);
  };

  const dates = rows.map((r) => r.date).sort();
  remember(
    await database
      .select(columns)
      .from(transactions)
      .where(
        and(
          owned,
          gte(transactions.date, addDays(dates[0], -MATCH_WINDOW_DAYS)),
          lte(transactions.date, addDays(dates[dates.length - 1], MATCH_WINDOW_DAYS)),
        ),
      ),
  );

  const hashes = [...new Set(rows.map((r) => r.dedupeHash))];
  const externalIds = [...new Set(rows.flatMap((r) => (r.externalId ? [r.externalId] : [])))];
  const matchOwner = and(eq(transactionMatches.userId, userId), eq(transactionMatches.accountId, accountId));
  const viaMatches = new Set<string>();
  for (const part of chunk(hashes, CHUNK_SIZE)) {
    remember(await database.select(columns).from(transactions).where(and(owned, inArray(transactions.dedupeHash, part))));
    const hits = await database
      .select({ id: transactionMatches.transactionId })
      .from(transactionMatches)
      .where(and(matchOwner, inArray(transactionMatches.dedupeHash, part)));
    for (const h of hits) viaMatches.add(h.id);
  }
  for (const part of chunk(externalIds, CHUNK_SIZE)) {
    remember(await database.select(columns).from(transactions).where(and(owned, inArray(transactions.externalId, part))));
    const hits = await database
      .select({ id: transactionMatches.transactionId })
      .from(transactionMatches)
      .where(and(matchOwner, inArray(transactionMatches.externalId, part)));
    for (const h of hits) viaMatches.add(h.id);
  }
  const missing = [...viaMatches].filter((id) => !found.has(id));
  for (const part of chunk(missing, CHUNK_SIZE)) {
    remember(await database.select(columns).from(transactions).where(and(owned, inArray(transactions.id, part))));
  }

  // Every merged identity of every loaded row: they decide who is already linked to which side.
  const matched = new Map<string, MatchedIdentity[]>();
  for (const part of chunk([...found.keys()], CHUNK_SIZE)) {
    const identities = await database
      .select({
        transactionId: transactionMatches.transactionId,
        source: sql<"csv" | "sync">`${transactionMatches.source}`,
        dedupeHash: transactionMatches.dedupeHash,
        occurrenceIndex: transactionMatches.occurrenceIndex,
        externalId: transactionMatches.externalId,
      })
      .from(transactionMatches)
      .where(and(matchOwner, inArray(transactionMatches.transactionId, part)));
    for (const { transactionId, ...identity } of identities) {
      matched.set(transactionId, [...(matched.get(transactionId) ?? []), identity]);
    }
  }

  const existing = [...found.values()].map((r) => ({ ...r, matched: matched.get(r.id) ?? [] }));
  const decisions = matchIncoming(
    side,
    rows.map((r) => ({
      date: r.date,
      amountCents: r.amountCents,
      dedupeHash: r.dedupeHash,
      occurrenceIndex: r.occurrenceIndex,
      externalId: r.externalId ?? null,
    })),
    existing,
  );
  for (const d of decisions) counts[d.kind] += 1;
  return { decisions, counts };
}

export class AccountNotOwnedError extends Error {
  constructor() {
    super("Account does not belong to this user");
    this.name = "AccountNotOwnedError";
  }
}

export interface CommitImportInput {
  userId: string;
  accountId: string;
  /** The file's name, or the bank's name for a sync run. */
  filename: string;
  /** Defaults to "csv". A sync run stores `source` "sync" and each row's `externalId`. */
  kind?: ImportKind;
  rowsTotal: number;
  rowsError: number;
  /** Rows already known by other means, counted as duplicates. */
  rowsSkipped?: number;
  /** All valid rows of the file (duplicates included): existing ones get their bank category backfilled. */
  transactions: ImportRow[];
  /** Confirmed decisions from the import preview: categories to create and mappings to store. */
  bankWrites?: BankCategoryWrites;
  /** Runs inside the same DB transaction, after the rows are in (a sync saves its balance checkpoint here). */
  inTransaction?: (tx: Parameters<Parameters<typeof dbClient.transaction>[0]>[0]) => Promise<void>;
}

export interface CommitImportResult {
  import: Import;
  /** Existing transactions that got their bank category from this file. */
  rowsBackfilled: number;
  /** Rows of this import left uncategorized by rules and bank mappings that got a guessed category. */
  rowsGuessed: number;
  /** Rows merged into an existing row of the other side (counted in `rowsDuplicate` too). */
  rowsMerged: number;
  /** Rows that took over a row added by hand and waiting for the bank (counted in `rowsDuplicate` too). */
  rowsAdopted: number;
  /** Rows inserted as a possible duplicate of existing rows, left for Review. */
  rowsPossible: number;
}

/**
 * Sets the bank category of rows that already exist and have none, matched on
 * (account, hash, occurrence). Only those two columns change, and only where
 * both are null, so re-imports never overwrite anything.
 */
async function backfillBankCategories(
  tx: Pick<typeof dbClient, "execute">,
  userId: string,
  accountId: string,
  rows: readonly KeyedTransaction[],
): Promise<number> {
  const withBank = rows.filter((r) => r.bankCategory !== null);
  let updated = 0;
  for (const part of chunk(withBank, CHUNK_SIZE)) {
    const values = sql.join(
      part.map(
        (r) =>
          sql`(${r.dedupeHash}::text, ${r.occurrenceIndex}::int, ${r.bankCategory}::text, ${r.bankSubcategory}::text)`,
      ),
      sql`, `,
    );
    const done = await tx.execute(sql`
      update transactions t
      set bank_category = v.bank_category, bank_subcategory = v.bank_subcategory
      from (values ${values}) as v(dedupe_hash, occurrence_index, bank_category, bank_subcategory)
      where t.user_id = ${userId}
        and t.account_id = ${accountId}
        and t.dedupe_hash = v.dedupe_hash
        and t.occurrence_index = v.occurrence_index
        and t.bank_category is null
        and t.bank_subcategory is null
      returning t.id
    `);
    updated += done.length;
  }
  return updated;
}

/**
 * Records the import and inserts its transactions in one DB transaction.
 * The unique constraint (account, hash, occurrence) is the last line of
 * defence against duplicates, e.g. two imports racing.
 *
 * Ownership of `accountId` is re-checked inside the transaction so this
 * function is safe even if a caller forgets `getOwnedAccount`.
 */
export async function commitImport(
  database: typeof dbClient,
  input: CommitImportInput,
): Promise<CommitImportResult> {
  const { userId, accountId } = input;
  const kind = input.kind ?? "csv";
  return database.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    if (!owned) throw new AccountNotOwnedError();

    const [created] = await tx
      .insert(imports)
      .values({
        userId,
        accountId,
        filename: input.filename,
        kind,
        rowsTotal: input.rowsTotal,
        rowsError: input.rowsError,
      })
      .returning();

    if (input.bankWrites) await applyBankCategoryWrites(tx, userId, input.bankWrites);

    // Compiled once per import; rows get their category at insert time so
    // no second pass over the new rows is needed. Precedence: rule, then bank.
    const rules = await loadCompiledRules(tx, userId);
    const bankMappings = buildMappingLookup(await loadBankMappings(tx, userId));
    // Merchant names come first so rules can match them too.
    const merchantLookup = await loadMerchantLookup(tx, userId);

    // Category and merchant an incoming row gets: rule first, then the bank mapping.
    const categorizeIncoming = (t: ImportRow) => {
      const labelDisplay = t.labelSimplified || t.labelRaw;
      const merchantId = resolveMerchant(merchantLookup.patterns, {
        normalized: t.labelNormalized,
        display: labelDisplay,
      });
      const ruleCategoryId = categorizeLabel(rules, {
        normalized: t.labelNormalized,
        display: labelDisplay,
        merchant: merchantId === null ? null : (merchantLookup.names.get(merchantId) ?? null),
      });
      const bankCategoryId = ruleCategoryId === null ? resolveBankCategory(t, bankMappings) : null;
      const categoryId = ruleCategoryId ?? bankCategoryId;
      const categorySource =
        ruleCategoryId !== null ? ("rule" as const) : bankCategoryId !== null ? ("bank" as const) : null;
      return { labelDisplay, merchantId, categoryId, categorySource };
    };

    const { decisions } = await planMatches(tx, userId, accountId, kind, input.transactions);
    // Exact duplicates and merges insert nothing; ON CONFLICT below stays as the last line of defence.
    const toInsert = input.transactions.filter((_, i) => {
      const d = decisions[i].kind;
      return d === "insert" || d === "possible";
    });
    const candidatesByKey = new Map<string, string[]>();
    input.transactions.forEach((t, i) => {
      const d = decisions[i];
      if (d.kind === "possible") candidatesByKey.set(dedupeKey(t), d.candidateIds);
    });

    let inserted = 0;
    let possible = 0;
    const insertedIds: string[] = [];
    for (const part of chunk(toInsert, CHUNK_SIZE)) {
      const insert = tx
        .insert(transactions)
        .values(
          part.map((t) => {
            const { labelDisplay, merchantId, categoryId, categorySource } = categorizeIncoming(t);
            return {
              userId,
              accountId,
              importId: created.id,
              date: t.date,
              bookedOn: t.bookedOn ?? null,
              amountCents: t.amountCents,
              labelRaw: t.labelRaw,
              labelNormalized: t.labelNormalized,
              labelDisplay,
              merchantId,
              categoryId,
              categorySource,
              bankCategory: t.bankCategory,
              bankSubcategory: t.bankSubcategory,
              dedupeHash: t.dedupeHash,
              occurrenceIndex: t.occurrenceIndex,
              source: kind,
              externalId: t.externalId ?? null,
              // Imported rows enter the review queue (Slice 26); the column default marks other inserts reviewed.
              reviewedAt: null,
            };
          }),
        );
      // A synced row can also hit the (account, external_id) index, so any conflict is a duplicate.
      const rows = await (kind === "sync"
        ? insert.onConflictDoNothing()
        : insert.onConflictDoNothing({
            target: [transactions.accountId, transactions.dedupeHash, transactions.occurrenceIndex],
          })
      ).returning({
        id: transactions.id,
        dedupeHash: transactions.dedupeHash,
        occurrenceIndex: transactions.occurrenceIndex,
      });
      inserted += rows.length;
      insertedIds.push(...rows.map((r) => r.id));

      // Matched back by identity, not position: ON CONFLICT DO NOTHING may have skipped rows.
      const links = rows.flatMap((r) =>
        (candidatesByKey.get(dedupeKey(r)) ?? []).map((candidateId) => ({
          userId,
          transactionId: r.id,
          candidateId,
        })),
      );
      possible += rows.filter((r) => candidatesByKey.has(dedupeKey(r))).length;
      if (links.length > 0) await tx.insert(duplicateCandidates).values(links).onConflictDoNothing();
    }

    // Same purchase as a row of the other side (merge), or the same hash as one (link): remember this
    // identity on the kept row, which stays untouched. Linking stops that row absorbing a second purchase later.
    const merges = input.transactions.flatMap((t, i) => {
      const d = decisions[i];
      return d.kind === "merge" || (d.kind === "duplicate" && d.link)
        ? [
            {
              userId,
              accountId,
              transactionId: d.targetId,
              importId: created.id,
              source: kind,
              dedupeHash: t.dedupeHash,
              occurrenceIndex: t.occurrenceIndex,
              externalId: t.externalId ?? null,
            },
          ]
        : [];
    });
    for (const part of chunk(merges, CHUNK_SIZE)) {
      await tx.insert(transactionMatches).values(part).onConflictDoNothing();
    }
    // The kept row learns the booking date it lacked (rows from before Slice 48, or a CSV row the
    // bank's date now completes); an existing one is never overwritten.
    for (const [i, t] of input.transactions.entries()) {
      const d = decisions[i];
      if (t.bookedOn && (d.kind === "merge" || (d.kind === "duplicate" && d.link))) {
        await tx
          .update(transactions)
          .set({ bookedOn: t.bookedOn })
          .where(and(eq(transactions.id, d.targetId), eq(transactions.userId, userId), isNull(transactions.bookedOn)));
      }
    }
    // A row added by hand takes over the incoming row's identity, in place, so its category, note,
    // tags, splits and links stay. It keeps its own category, else gets the one the bank row would have.
    for (const [i, t] of input.transactions.entries()) {
      const d = decisions[i];
      if (d.kind !== "adopt") continue;
      const c = categorizeIncoming(t);
      await tx
        .update(transactions)
        .set({
          date: t.date,
          bookedOn: t.bookedOn ?? null,
          labelRaw: t.labelRaw,
          labelNormalized: t.labelNormalized,
          labelDisplay: c.labelDisplay,
          merchantId: c.merchantId,
          bankCategory: t.bankCategory,
          bankSubcategory: t.bankSubcategory,
          dedupeHash: t.dedupeHash,
          occurrenceIndex: t.occurrenceIndex,
          externalId: t.externalId ?? null,
          source: kind,
          awaitingBank: false,
          categoryId: sql`coalesce(${transactions.categoryId}, ${c.categoryId}::uuid)`,
          categorySource: sql`case when ${transactions.categoryId} is null then ${c.categorySource}::category_source else ${transactions.categorySource} end`,
        })
        .where(
          and(eq(transactions.id, d.targetId), eq(transactions.userId, userId), eq(transactions.awaitingBank, true)),
        );
    }
    const rowsMerged = decisions.filter((d) => d.kind === "merge").length;
    const rowsAdopted = decisions.filter((d) => d.kind === "adopt").length;

    // Synced rows carry no bank category, so there is nothing to backfill.
    const rowsBackfilled = kind === "csv" ? await backfillBankCategories(tx, userId, accountId, input.transactions) : 0;
    // Newly mapped bank categories also categorize older uncategorized rows.
    await applyBankMappings(tx, userId);
    // Last in the precedence (rule, bank, guess): only rows of this import still uncategorized.
    const rowsGuessed = (await guessInTransaction(tx, userId, { ids: insertedIds })).length;

    const [updated] = await tx
      .update(imports)
      .set({
        rowsTotal: input.rowsTotal,
        rowsInserted: inserted,
        rowsDuplicate: input.transactions.length - inserted + (input.rowsSkipped ?? 0),
        rowsError: input.rowsError,
      })
      .where(and(eq(imports.id, created.id), eq(imports.userId, userId)))
      .returning();
    if (input.inTransaction) await input.inTransaction(tx);
    return { import: updated, rowsBackfilled, rowsGuessed, rowsMerged, rowsAdopted, rowsPossible: possible };
  });
}

const DEFAULT_HISTORY_LIMIT = 50;

export interface ImportListItem extends Import {
  /** Name of the import's account (the user's own data, not translated). */
  accountName: string;
}

/** This user's imports, newest first. */
export async function listImports(
  database: typeof dbClient,
  userId: string,
  limit = DEFAULT_HISTORY_LIMIT,
): Promise<ImportListItem[]> {
  const rows = await database
    .select({ import: imports, accountName: accounts.name })
    .from(imports)
    .innerJoin(accounts, and(eq(accounts.id, imports.accountId), eq(accounts.userId, userId)))
    .where(and(eq(imports.userId, userId), ne(imports.kind, "franc")))
    .orderBy(desc(imports.uploadedAt), desc(imports.id))
    .limit(limit);
  return rows.map((r) => ({ ...r.import, accountName: r.accountName }));
}

/**
 * Deletes one of the user's imports. The `transactions.import_id` FK cascades,
 * so this removes exactly the rows that import inserted — rows a later import
 * saw as duplicates belong to the earlier import and are untouched.
 *
 * Returns `null` when the import doesn't exist or isn't the user's.
 */
export async function undoImport(
  database: typeof dbClient,
  userId: string,
  importId: string,
): Promise<{ deleted: number } | null> {
  return database.transaction(async (tx) => {
    const [{ value: deleted }] = await tx
      .select({ value: count() })
      .from(transactions)
      .where(and(eq(transactions.importId, importId), eq(transactions.userId, userId)));

    // Sync runs have no Undo (SPEC §60): undone rows would come back on the next sync.
    const removed = await tx
      .delete(imports)
      .where(and(eq(imports.id, importId), eq(imports.userId, userId), eq(imports.kind, "csv")))
      .returning({ id: imports.id });
    if (removed.length === 0) return null;

    return { deleted };
  });
}

/** Earliest and latest date among one import's rows, or null when it added none. */
export async function importDateRange(
  database: typeof dbClient,
  userId: string,
  importId: string,
): Promise<{ from: string; to: string } | null> {
  const [row] = await database
    .select({ from: sql<string | null>`min(${transactions.date})::text`, to: sql<string | null>`max(${transactions.date})::text` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.importId, importId)));
  return row?.from && row.to ? { from: row.from, to: row.to } : null;
}
