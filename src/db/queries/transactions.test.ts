// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Cursor, TransactionFilters } from "../../lib/transactions/filters";
import { normalizeLabel } from "../../lib/import/normalize-label";
import { db } from "../client";
import { categories, imports, transactions, transactionTags } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { createAccount, listAccounts } from "./accounts";
import { provisionUserDefaults } from "./provision";
import { saveSplit } from "./splits";
import { addTagsToTransaction, setTransactionNote } from "./tags";
import { linkTransfer } from "./transfers";
import {
  bulkSetTransactionCategory,
  countTransactions,
  listTransactions,
  PAGE_SIZE,
  restoreTransactionCategory,
  sumTransactions,
  sumTransactionsByDay,
} from "./transactions";

const ALL: TransactionFilters = { direction: "all" };

interface Seed {
  date: string;
  amountCents: number;
  label: string;
  labelDisplay?: string | null;
  categoryId?: string | null;
}

let seq = 0;

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [account] = await listAccounts(user.id);
  const [imp] = await db
    .insert(imports)
    .values({ userId: user.id, accountId: account.id, filename: "x.csv", rowsTotal: 0, rowsError: 0 })
    .returning();
  return { user, account, importId: imp.id };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function seed(ctx: Ctx, rows: Seed[]): Promise<string[]> {
  if (rows.length === 0) return [];
  const inserted = await db
    .insert(transactions)
    .values(
      rows.map((r) => {
        seq += 1;
        return {
          userId: ctx.user.id,
          accountId: ctx.account.id,
          importId: ctx.importId,
          date: r.date,
          amountCents: r.amountCents,
          labelRaw: r.label,
          labelNormalized: normalizeLabel(r.label),
          labelDisplay: r.labelDisplay === undefined ? r.label : r.labelDisplay,
          categoryId: r.categoryId ?? null,
          dedupeHash: `hash-${seq}`,
          occurrenceIndex: 0,
        };
      }),
    )
    .returning({ id: transactions.id });
  return inserted.map((r) => r.id);
}

async function labels(ctx: Ctx, filters: TransactionFilters) {
  const { items } = await listTransactions(db, ctx.user.id, filters, null);
  return items.map((i) => i.label);
}

describe("listTransactions", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("never returns another user's rows, even with their category id", async () => {
    const a = await setup();
    const b = await setup();
    const [catB] = await db.insert(categories).values({ userId: b.user.id, name: "Secret", color: "#000000" }).returning();
    await seed(a, [{ date: "2025-01-01", amountCents: -100, label: "MINE" }]);
    await seed(b, [{ date: "2025-01-01", amountCents: -100, label: "THEIRS", categoryId: catB.id }]);

    expect(await labels(a, ALL)).toEqual(["MINE"]);
    expect(await labels(a, { ...ALL, category: catB.id })).toEqual([]);
    expect(await countTransactions(db, a.user.id, { ...ALL, category: catB.id })).toBe(0);
  });

  it("orders newest first with an id tie-break on the same date", async () => {
    const ctx = await setup();
    const ids = await seed(ctx, [
      { date: "2025-01-02", amountCents: -1, label: "A" },
      { date: "2025-01-03", amountCents: -1, label: "B" },
      { date: "2025-01-03", amountCents: -1, label: "C" },
      { date: "2025-01-01", amountCents: -1, label: "D" },
    ]);
    const { items } = await listTransactions(db, ctx.user.id, ALL, null);
    expect(items.map((i) => i.date)).toEqual(["2025-01-03", "2025-01-03", "2025-01-02", "2025-01-01"]);
    const sameDay = items.slice(0, 2).map((i) => i.id);
    expect(sameDay).toEqual([...sameDay].sort().reverse());
    expect(new Set(items.map((i) => i.id))).toEqual(new Set(ids));
  });

  it("pages through 120 rows without gaps or duplicates", async () => {
    const ctx = await setup();
    // Few distinct dates so most pages split inside a same-date run.
    const ids = await seed(
      ctx,
      Array.from({ length: 120 }, (_, i) => ({
        date: `2025-01-${String((i % 7) + 1).padStart(2, "0")}`,
        amountCents: -(i + 1),
        label: `ROW ${i}`,
      })),
    );

    const seen: string[] = [];
    let cursor: Cursor | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof listTransactions>> = await listTransactions(
        db,
        ctx.user.id,
        ALL,
        cursor,
        PAGE_SIZE,
      );
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it("returns a null cursor when exactly one full page remains", async () => {
    const ctx = await setup();
    await seed(ctx, Array.from({ length: 3 }, (_, i) => ({ date: "2025-01-01", amountCents: -1, label: `R${i}` })));
    const page = await listTransactions(db, ctx.user.id, ALL, null, 3);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("searches display label, raw label, case- and accent-insensitively", async () => {
    const ctx = await setup();
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -1, label: "CB CAFÉ DU COIN", labelDisplay: "Café du Coin" },
      { date: "2025-01-02", amountCents: -1, label: "PRLV ORANGE SA", labelDisplay: "Facture mobile" },
      { date: "2025-01-03", amountCents: -1, label: "AUTRE", labelDisplay: null },
    ]);
    expect(await labels(ctx, { ...ALL, q: "cafe" })).toEqual(["Café du Coin"]);
    expect(await labels(ctx, { ...ALL, q: "CAFÉ" })).toEqual(["Café du Coin"]);
    // Only the normalized/raw label contains "orange"; the display label was edited.
    expect(await labels(ctx, { ...ALL, q: "orange" })).toEqual(["Facture mobile"]);
    expect(await labels(ctx, { ...ALL, q: "facture" })).toEqual(["Facture mobile"]);
    expect(await labels(ctx, { ...ALL, q: "autre" })).toEqual(["AUTRE"]);
    expect(await countTransactions(db, ctx.user.id, { ...ALL, q: "cafe" })).toBe(1);
  });

  it("ignores accents on the display label in both directions", async () => {
    const ctx = await setup();
    // The raw labels don't contain the word, so only label_display can match.
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -1, label: "CB 1234 CLINIQUE", labelDisplay: "Clinique Vétérinaire" },
      { date: "2025-01-02", amountCents: -1, label: "CB 5678 CABINET", labelDisplay: "Cabinet Veterinaire" },
    ]);
    const both = ["Cabinet Veterinaire", "Clinique Vétérinaire"];
    expect(await labels(ctx, { ...ALL, q: "Vétérinaire" })).toEqual(both);
    expect(await labels(ctx, { ...ALL, q: "Veterinaire" })).toEqual(both);
    expect(await labels(ctx, { ...ALL, q: "VÉTÉ" })).toEqual(both);
    expect(await countTransactions(db, ctx.user.id, { ...ALL, q: "veterinaire" })).toBe(2);
  });

  it("matches % and _ literally", async () => {
    const ctx = await setup();
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -1, label: "PROMO 50% OFF" },
      { date: "2025-01-02", amountCents: -1, label: "PROMO 50 OFF" },
      { date: "2025-01-03", amountCents: -1, label: "A_B" },
      { date: "2025-01-04", amountCents: -1, label: "AXB" },
      { date: "2025-01-05", amountCents: -1, label: "BACK\\SLASH" },
    ]);
    expect(await labels(ctx, { ...ALL, q: "50%" })).toEqual(["PROMO 50% OFF"]);
    expect(await labels(ctx, { ...ALL, q: "a_b" })).toEqual(["A_B"]);
    expect(await labels(ctx, { ...ALL, q: "%" })).toEqual(["PROMO 50% OFF"]);
    expect(await labels(ctx, { ...ALL, q: "\\" })).toEqual(["BACK\\SLASH"]);
  });

  it("ignores a search that normalizes to empty", async () => {
    const ctx = await setup();
    await seed(ctx, [{ date: "2025-01-01", amountCents: -1, label: "X" }]);
    expect(await labels(ctx, { ...ALL, q: "́" })).toEqual(["X"]);
  });

  it("treats date bounds as inclusive", async () => {
    const ctx = await setup();
    await seed(ctx, ["2025-01-09", "2025-01-10", "2025-01-15", "2025-01-20", "2025-01-21"].map((date) => ({
      date,
      amountCents: -1,
      label: date,
    })));
    expect(await labels(ctx, { ...ALL, from: "2025-01-10", to: "2025-01-20" })).toEqual([
      "2025-01-20",
      "2025-01-15",
      "2025-01-10",
    ]);
    expect(await labels(ctx, { ...ALL, from: "2025-01-21" })).toEqual(["2025-01-21"]);
    expect(await labels(ctx, { ...ALL, to: "2025-01-09" })).toEqual(["2025-01-09"]);
  });

  it("filters by category and uncategorized", async () => {
    const ctx = await setup();
    const [cat] = await db.insert(categories).values({ userId: ctx.user.id, name: "Food", color: "#ff0000" }).returning();
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -1, label: "WITH", categoryId: cat.id },
      { date: "2025-01-02", amountCents: -1, label: "WITHOUT" },
    ]);
    expect(await labels(ctx, { ...ALL, category: cat.id })).toEqual(["WITH"]);
    expect(await labels(ctx, { ...ALL, category: "none" })).toEqual(["WITHOUT"]);
    const { items } = await listTransactions(db, ctx.user.id, ALL, null);
    expect(items.find((i) => i.label === "WITH")?.category).toEqual({ id: cat.id, name: "Food", color: "#ff0000", icon: null, parentName: null });
    expect(items.find((i) => i.label === "WITHOUT")?.category).toBeNull();
  });

  it("applies absolute min/max combined with direction", async () => {
    const ctx = await setup();
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -500, label: "OUT5" },
      { date: "2025-01-02", amountCents: -1500, label: "OUT15" },
      { date: "2025-01-03", amountCents: 1500, label: "IN15" },
      { date: "2025-01-04", amountCents: 5000, label: "IN50" },
    ]);
    expect((await labels(ctx, { ...ALL, min: 1000 })).sort()).toEqual(["IN15", "IN50", "OUT15"]);
    expect((await labels(ctx, { ...ALL, min: 1500, max: 1500 })).sort()).toEqual(["IN15", "OUT15"]);
    expect(await labels(ctx, { ...ALL, direction: "out", min: 1000 })).toEqual(["OUT15"]);
    expect(await labels(ctx, { ...ALL, direction: "in", max: 2000 })).toEqual(["IN15"]);
    expect(await labels(ctx, { ...ALL, direction: "out" })).toEqual(["OUT15", "OUT5"]);
  });

  it("countTransactions agrees with the full list under filters", async () => {
    const ctx = await setup();
    await seed(
      ctx,
      Array.from({ length: 75 }, (_, i) => ({
        date: `2025-02-${String((i % 20) + 1).padStart(2, "0")}`,
        amountCents: i % 2 === 0 ? -(i + 1) * 100 : (i + 1) * 100,
        label: i % 3 === 0 ? `SHOP ${i}` : `OTHER ${i}`,
      })),
    );
    for (const filters of [
      ALL,
      { ...ALL, q: "shop" },
      { ...ALL, direction: "out" as const, min: 1000 },
      { ...ALL, from: "2025-02-05", to: "2025-02-10" },
    ]) {
      let total = 0;
      let cursor: Cursor | null = null;
      do {
        const page: Awaited<ReturnType<typeof listTransactions>> = await listTransactions(db, ctx.user.id, filters, cursor, 20);
        total += page.items.length;
        cursor = page.nextCursor;
      } while (cursor);
      expect(await countTransactions(db, ctx.user.id, filters)).toBe(total);
    }
  });
});

describe("category hierarchy in the list", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function tree(ctx: Ctx) {
    const [parent] = await db.insert(categories).values({ userId: ctx.user.id, name: "Zparent", color: "#111111" }).returning();
    const [child] = await db
      .insert(categories)
      .values({ userId: ctx.user.id, name: "Zchild", color: "#222222", parentId: parent.id })
      .returning();
    const [other] = await db.insert(categories).values({ userId: ctx.user.id, name: "Zother", color: "#333333" }).returning();
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -1, label: "P", categoryId: parent.id },
      { date: "2025-01-02", amountCents: -1, label: "C", categoryId: child.id },
      { date: "2025-01-03", amountCents: -1, label: "O", categoryId: other.id },
    ]);
    return { parent, child, other };
  }

  it("a parent filter includes its subcategories; a child filter only itself", async () => {
    const ctx = await setup();
    const { parent, child } = await tree(ctx);
    expect((await labels(ctx, { ...ALL, category: parent.id })).sort()).toEqual(["C", "P"]);
    expect(await countTransactions(db, ctx.user.id, { ...ALL, category: parent.id })).toBe(2);
    expect(await labels(ctx, { ...ALL, category: child.id })).toEqual(["C"]);
    expect(await countTransactions(db, ctx.user.id, { ...ALL, category: child.id })).toBe(1);
  });

  it("another user's parent id matches nothing", async () => {
    const a = await setup();
    const b = await setup();
    const { parent } = await tree(b);
    expect(await labels(a, { ...ALL, category: parent.id })).toEqual([]);
    expect(await countTransactions(db, a.user.id, { ...ALL, category: parent.id })).toBe(0);
  });

  it("rows carry the parent name", async () => {
    const ctx = await setup();
    await tree(ctx);
    const { items } = await listTransactions(db, ctx.user.id, ALL, null);
    const byLabel = Object.fromEntries(items.map((i) => [i.label, i.category?.parentName]));
    expect(byLabel).toEqual({ P: null, C: "Zparent", O: null });
  });
});

describe("bulkSetTransactionCategory", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sets manual source on all, then clears both", async () => {
    const ctx = await setup();
    const [parent] = await db.insert(categories).values({ userId: ctx.user.id, name: "Zparent", color: "#111111" }).returning();
    const [child] = await db
      .insert(categories)
      .values({ userId: ctx.user.id, name: "Zchild", color: "#222222", parentId: parent.id })
      .returning();
    const ids = await seed(ctx, [
      { date: "2025-01-01", amountCents: -1, label: "A" },
      { date: "2025-01-02", amountCents: -1, label: "B", categoryId: parent.id },
    ]);

    const res = await bulkSetTransactionCategory(db, ctx.user.id, ids, child.id);
    expect(res).toEqual({ updated: 2, skipped: 0, category: { id: child.id, name: "Zchild", color: "#222222", icon: null, parentName: "Zparent" } });
    let rows = await db.select().from(transactions).where(eq(transactions.userId, ctx.user.id));
    expect(rows.every((r) => r.categoryId === child.id && r.categorySource === "manual")).toBe(true);

    expect(await bulkSetTransactionCategory(db, ctx.user.id, ids, null)).toEqual({ updated: 2, skipped: 0, category: null });
    rows = await db.select().from(transactions).where(eq(transactions.userId, ctx.user.id));
    expect(rows.every((r) => r.categoryId === null && r.categorySource === null)).toBe(true);
  });

  it("ignores and doesn't count other users' transactions", async () => {
    const a = await setup();
    const b = await setup();
    const [cat] = await db.insert(categories).values({ userId: a.user.id, name: "Zmine", color: "#111111" }).returning();
    const [mine] = await seed(a, [{ date: "2025-01-01", amountCents: -1, label: "MINE" }]);
    const [theirs] = await seed(b, [{ date: "2025-01-01", amountCents: -1, label: "THEIRS" }]);

    const res = await bulkSetTransactionCategory(db, a.user.id, [mine, theirs], cat.id);
    expect(res?.updated).toBe(1);
    const [row] = await db.select().from(transactions).where(eq(transactions.id, theirs));
    expect(row.categoryId).toBeNull();
    expect(row.categorySource).toBeNull();
  });

  it("rejects another user's category and changes nothing", async () => {
    const a = await setup();
    const b = await setup();
    const [foreign] = await db.insert(categories).values({ userId: b.user.id, name: "Zforeign", color: "#111111" }).returning();
    const [mine] = await seed(a, [{ date: "2025-01-01", amountCents: -1, label: "MINE" }]);
    expect(await bulkSetTransactionCategory(db, a.user.id, [mine], foreign.id)).toBeNull();
    const [row] = await db.select().from(transactions).where(eq(transactions.id, mine));
    expect(row.categoryId).toBeNull();
  });
});

describe("tags and notes in the list", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function tagged() {
    const ctx = await setup();
    const [trip, other] = await seed(ctx, [
      { date: "2025-01-02", amountCents: -1000, label: "HOTEL" },
      { date: "2025-01-01", amountCents: -500, label: "BAKERY" },
    ]);
    await addTagsToTransaction(db, ctx.user.id, trip, ["Voyage été", "Holidays"]);
    await setTransactionNote(db, ctx.user.id, trip, "Réservé pour Noël");
    return { ctx, trip, other };
  }

  it("returns note and sorted tags on list items, and empty ones otherwise", async () => {
    const { ctx, trip } = await tagged();
    const { items } = await listTransactions(db, ctx.user.id, ALL, null);
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(trip)?.tags.map((t) => t.name)).toEqual(["Holidays", "Voyage été"]);
    expect(byId.get(trip)?.note).toBe("Réservé pour Noël");
    const other = items.find((i) => i.id !== trip);
    expect(other?.tags).toEqual([]);
    expect(other?.note).toBeNull();
  });

  it("filters by tag, and another user's tag id matches nothing", async () => {
    const { ctx, trip } = await tagged();
    const { items } = await listTransactions(db, ctx.user.id, ALL, null);
    const tagId = items.find((i) => i.id === trip)?.tags[0].id as string;
    expect((await listTransactions(db, ctx.user.id, { ...ALL, tag: tagId }, null)).items.map((i) => i.id)).toEqual([trip]);
    expect(await countTransactions(db, ctx.user.id, { ...ALL, tag: tagId })).toBe(1);

    const stranger = await setup();
    expect(await countTransactions(db, stranger.user.id, { ...ALL, tag: tagId })).toBe(0);
    expect((await sumTransactions(db, stranger.user.id, { ...ALL, tag: tagId }))).toEqual({ outCents: 0, inCents: 0 });
  });

  it("searches notes and tag names, accent-insensitively, without leaking across users", async () => {
    const { ctx, trip } = await tagged();
    expect(await labels(ctx, { ...ALL, q: "noel" })).toEqual(["HOTEL"]);
    expect(await labels(ctx, { ...ALL, q: "ete" })).toEqual(["HOTEL"]);
    expect(await labels(ctx, { ...ALL, q: "holid" })).toEqual(["HOTEL"]);
    const stranger = await setup();
    await seed(stranger, [{ date: "2025-01-01", amountCents: -1, label: "OTHER" }]);
    expect(await labels(stranger, { ...ALL, q: "holid" })).toEqual([]);
    expect(await labels(stranger, { ...ALL, q: "noel" })).toEqual([]);
    expect(trip).toBeDefined();
  });

  it("rejects a link to another user's tag (composite FK)", async () => {
    const a = await tagged();
    const b = await setup();
    const [bTx] = await seed(b, [{ date: "2025-01-01", amountCents: -1, label: "B" }]);
    const [{ id: aTag }] = (await listTransactions(db, a.ctx.user.id, ALL, null)).items.flatMap((i) => i.tags);
    await expect(
      db.insert(transactionTags).values({ transactionId: bTx, tagId: aTag, userId: b.user.id }),
    ).rejects.toThrow();
    // A link claiming to be the tag owner's but on another user's transaction fails too.
    await expect(
      db.insert(transactionTags).values({ transactionId: bTx, tagId: aTag, userId: a.ctx.user.id }),
    ).rejects.toThrow();
  });
});

describe("sumTransactions", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is zero for no rows and sums outflows and inflows separately", async () => {
    const ctx = await setup();
    expect(await sumTransactions(db, ctx.user.id, ALL)).toEqual({ outCents: 0, inCents: 0 });
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -1000, label: "A" },
      { date: "2025-01-02", amountCents: -234, label: "B" },
      { date: "2025-01-03", amountCents: 5000, label: "SALARY" },
    ]);
    expect(await sumTransactions(db, ctx.user.id, ALL)).toEqual({ outCents: -1234, inCents: 5000 });
    expect(await sumTransactions(db, ctx.user.id, { ...ALL, direction: "out" })).toEqual({ outCents: -1234, inCents: 0 });
    expect(await sumTransactions(db, ctx.user.id, { ...ALL, q: "salary" })).toEqual({ outCents: 0, inCents: 5000 });
  });

  it("does not overflow 32 bits", async () => {
    const ctx = await setup();
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -2_000_000_000, label: "A" },
      { date: "2025-01-02", amountCents: -2_000_000_000, label: "B" },
    ]);
    expect((await sumTransactions(db, ctx.user.id, ALL)).outCents).toBe(-4_000_000_000);
  });

  it("counts only the matching parts of a split under a category filter", async () => {
    const ctx = await setup();
    const [food] = await db.insert(categories).values({ userId: ctx.user.id, name: "Food", color: "#111111" }).returning();
    const [fun] = await db.insert(categories).values({ userId: ctx.user.id, name: "Fun", color: "#222222" }).returning();
    const [sub] = await db
      .insert(categories)
      .values({ userId: ctx.user.id, name: "Snacks", color: "#333333", parentId: food.id })
      .returning();
    const [split, plain] = await seed(ctx, [
      { date: "2025-01-01", amountCents: -1000, label: "SPLIT", categoryId: fun.id },
      { date: "2025-01-02", amountCents: -300, label: "PLAIN", categoryId: sub.id },
    ]);
    const saved = await saveSplit(db, ctx.user.id, split, [
      { categoryId: food.id, amountCents: -700 },
      { categoryId: fun.id, amountCents: -300 },
    ]);
    expect(saved.ok).toBe(true);
    expect(plain).toBeDefined();

    expect(await sumTransactions(db, ctx.user.id, ALL)).toEqual({ outCents: -1300, inCents: 0 });
    // Parent covers its children: 700 from the split part + 300 from the plain subcategory row.
    expect(await sumTransactions(db, ctx.user.id, { ...ALL, category: food.id })).toEqual({ outCents: -1000, inCents: 0 });
    // Fun: only the 300 part, never the row's own 1000.
    expect(await sumTransactions(db, ctx.user.id, { ...ALL, category: fun.id })).toEqual({ outCents: -300, inCents: 0 });
    // Nothing is uncategorized.
    expect(await sumTransactions(db, ctx.user.id, { ...ALL, category: "none" })).toEqual({ outCents: 0, inCents: 0 });
  });

  it("includes internal transfers unless hidden", async () => {
    const ctx = await setup();
    const created = await createAccount(db, ctx.user.id, "Savings");
    if (!created.ok) throw new Error("createAccount failed");
    const [out, inn, spend] = await Promise.all([
      db.insert(transactions).values({ userId: ctx.user.id, accountId: ctx.account.id, importId: ctx.importId, date: "2025-01-01", amountCents: -5000, labelRaw: "T1", labelNormalized: "t1", labelDisplay: "T1", dedupeHash: "tr-1", occurrenceIndex: 0 }).returning({ id: transactions.id }),
      db.insert(transactions).values({ userId: ctx.user.id, accountId: created.account.id, importId: ctx.importId, date: "2025-01-01", amountCents: 5000, labelRaw: "T2", labelNormalized: "t2", labelDisplay: "T2", dedupeHash: "tr-2", occurrenceIndex: 0 }).returning({ id: transactions.id }),
      seed(ctx, [{ date: "2025-01-02", amountCents: -200, label: "COFFEE" }]),
    ]);
    expect((await linkTransfer(db, ctx.user.id, out[0].id, inn[0].id)).ok).toBe(true);
    expect(spend).toHaveLength(1);
    expect(await sumTransactions(db, ctx.user.id, ALL)).toEqual({ outCents: -5200, inCents: 5000 });
    expect(await sumTransactions(db, ctx.user.id, { ...ALL, transfers: "hide" })).toEqual({ outCents: -200, inCents: 0 });
  });

  it("totals a tag across categories", async () => {
    const ctx = await setup();
    const [a, b] = await seed(ctx, [
      { date: "2025-01-01", amountCents: -1000, label: "A" },
      { date: "2025-01-02", amountCents: -2000, label: "B" },
      { date: "2025-01-03", amountCents: -4000, label: "C" },
    ]);
    await addTagsToTransaction(db, ctx.user.id, a, ["Trip"]);
    const res = await addTagsToTransaction(db, ctx.user.id, b, ["trip"]);
    if (!res.ok) throw new Error(res.code);
    expect(await sumTransactions(db, ctx.user.id, { ...ALL, tag: res.tags[0].id })).toEqual({ outCents: -3000, inCents: 0 });
  });
});

describe("sumTransactionsByDay", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is empty for no dates and sums several rows of a day", async () => {
    const ctx = await setup();
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -1000, label: "A" },
      { date: "2025-01-01", amountCents: 400, label: "B" },
      { date: "2025-01-02", amountCents: -250, label: "C" },
      { date: "2025-01-03", amountCents: -999, label: "D" },
    ]);
    expect(await sumTransactionsByDay(db, ctx.user.id, ALL, [])).toEqual({});
    expect(await sumTransactionsByDay(db, ctx.user.id, ALL, ["2025-01-01", "2025-01-02", "2025-01-09"])).toEqual({
      "2025-01-01": -600,
      "2025-01-02": -250,
    });
  });

  it("is scoped by user", async () => {
    const ctx = await setup();
    const stranger = await setup();
    await seed(ctx, [{ date: "2025-01-01", amountCents: -100, label: "MINE" }]);
    await seed(stranger, [{ date: "2025-01-01", amountCents: -900, label: "THEIRS" }]);
    expect(await sumTransactionsByDay(db, ctx.user.id, ALL, ["2025-01-01"])).toEqual({ "2025-01-01": -100 });
  });

  it("applies the filters", async () => {
    const ctx = await setup();
    await seed(ctx, [
      { date: "2025-01-01", amountCents: -1000, label: "A" },
      { date: "2025-01-01", amountCents: 5000, label: "SALARY" },
    ]);
    expect(await sumTransactionsByDay(db, ctx.user.id, { ...ALL, direction: "out" }, ["2025-01-01"])).toEqual({
      "2025-01-01": -1000,
    });
    expect(await sumTransactionsByDay(db, ctx.user.id, { ...ALL, q: "salary" }, ["2025-01-01"])).toEqual({
      "2025-01-01": 5000,
    });
  });

  it("counts only the matching parts of a split under a category filter", async () => {
    const ctx = await setup();
    const [food] = await db.insert(categories).values({ userId: ctx.user.id, name: "Food", color: "#111111" }).returning();
    const [fun] = await db.insert(categories).values({ userId: ctx.user.id, name: "Fun", color: "#222222" }).returning();
    const [split, plain] = await seed(ctx, [
      { date: "2025-01-01", amountCents: -1000, label: "SPLIT", categoryId: fun.id },
      { date: "2025-01-01", amountCents: -300, label: "PLAIN", categoryId: food.id },
    ]);
    expect(plain).toBeDefined();
    const saved = await saveSplit(db, ctx.user.id, split, [
      { categoryId: food.id, amountCents: -700 },
      { categoryId: fun.id, amountCents: -300 },
    ]);
    expect(saved.ok).toBe(true);
    const day = ["2025-01-01"];
    expect(await sumTransactionsByDay(db, ctx.user.id, ALL, day)).toEqual({ "2025-01-01": -600 - 700 });
    expect(await sumTransactionsByDay(db, ctx.user.id, { ...ALL, category: food.id }, day)).toEqual({ "2025-01-01": -1000 });
    expect(await sumTransactionsByDay(db, ctx.user.id, { ...ALL, category: fun.id }, day)).toEqual({ "2025-01-01": -300 });
  });

  it("hides internal transfers when asked", async () => {
    const ctx = await setup();
    const created = await createAccount(db, ctx.user.id, "Savings");
    if (!created.ok) throw new Error("createAccount failed");
    const [out, inn] = await Promise.all([
      db.insert(transactions).values({ userId: ctx.user.id, accountId: ctx.account.id, importId: ctx.importId, date: "2025-01-01", amountCents: -5000, labelRaw: "T1", labelNormalized: "t1", labelDisplay: "T1", dedupeHash: "trd-1", occurrenceIndex: 0 }).returning({ id: transactions.id }),
      db.insert(transactions).values({ userId: ctx.user.id, accountId: created.account.id, importId: ctx.importId, date: "2025-01-01", amountCents: 5000, labelRaw: "T2", labelNormalized: "t2", labelDisplay: "T2", dedupeHash: "trd-2", occurrenceIndex: 0 }).returning({ id: transactions.id }),
    ]);
    await seed(ctx, [{ date: "2025-01-01", amountCents: -200, label: "COFFEE" }]);
    expect((await linkTransfer(db, ctx.user.id, out[0].id, inn[0].id)).ok).toBe(true);
    expect(await sumTransactionsByDay(db, ctx.user.id, ALL, ["2025-01-01"])).toEqual({ "2025-01-01": -200 });
    expect(await sumTransactionsByDay(db, ctx.user.id, { ...ALL, transfers: "hide" }, ["2025-01-01"])).toEqual({ "2025-01-01": -200 });
    expect(await sumTransactionsByDay(db, ctx.user.id, { ...ALL, transfers: "only" }, ["2025-01-01"])).toEqual({ "2025-01-01": 0 });
  });
});

describe("restoreTransactionCategory", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function oneRow(ctx: Ctx) {
    const [cat] = await db.select().from(categories).where(eq(categories.userId, ctx.user.id)).limit(1);
    const [id] = await seed(ctx, [{ date: "2025-01-01", amountCents: -100, label: "SHOP" }]);
    return { id, cat };
  }

  it("restores category, source and an unreviewed state", async () => {
    const ctx = await setup();
    const { id, cat } = await oneRow(ctx);
    await db.update(transactions).set({ reviewedAt: new Date() }).where(eq(transactions.id, id));

    const result = await restoreTransactionCategory(db, ctx.user.id, id, {
      categoryId: cat.id,
      categorySource: "guess",
      reviewed: false,
    });
    expect(result?.categorySource).toBe("guess");
    expect(result?.category?.id).toBe(cat.id);
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    expect(row).toMatchObject({ categoryId: cat.id, categorySource: "guess", reviewedAt: null });
  });

  it("clears the category and marks reviewed", async () => {
    const ctx = await setup();
    const { id, cat } = await oneRow(ctx);
    await db.update(transactions).set({ categoryId: cat.id, categorySource: "manual" }).where(eq(transactions.id, id));

    const result = await restoreTransactionCategory(db, ctx.user.id, id, {
      categoryId: null,
      categorySource: null,
      reviewed: true,
    });
    expect(result).toEqual({ category: null, categorySource: null });
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    expect(row.categoryId).toBeNull();
    expect(row.categorySource).toBeNull();
    expect(row.reviewedAt).not.toBeNull();
  });

  it("rejects a foreign category and a foreign transaction without changing anything", async () => {
    const a = await setup();
    const b = await setup();
    const { id } = await oneRow(a);
    const [catB] = await db.insert(categories).values({ userId: b.user.id, name: "Secret", color: "#000000" }).returning();

    expect(
      await restoreTransactionCategory(db, a.user.id, id, { categoryId: catB.id, categorySource: "manual", reviewed: true }),
    ).toBeNull();
    expect(
      await restoreTransactionCategory(db, b.user.id, id, { categoryId: catB.id, categorySource: "manual", reviewed: true }),
    ).toBeNull();
    expect(
      await restoreTransactionCategory(db, b.user.id, id, { categoryId: null, categorySource: null, reviewed: true }),
    ).toBeNull();
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    expect(row.categoryId).toBeNull();
  });
});
