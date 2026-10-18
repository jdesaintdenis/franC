// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { normalizeLabel } from "../../lib/import/normalize-label";
import { MAX_TAGS_PER_TRANSACTION, MAX_TAGS_PER_USER } from "../../lib/tags/validate";
import { db } from "../client";
import { imports, tags, transactions, transactionTags } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import { undoImport } from "./imports";
import { provisionUserDefaults } from "./provision";
import {
  addTagsToTransaction,
  bulkAddTag,
  bulkRemoveTag,
  deleteTag,
  getOrCreateTags,
  listTags,
  loadTransactionTags,
  removeTagFromTransaction,
  renameTag,
  restoreTag,
  setTransactionNote,
} from "./tags";

let seq = 0;

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [account] = await listAccounts(user.id);
  const [imp] = await db
    .insert(imports)
    .values({ userId: user.id, accountId: account.id, filename: "x.csv", rowsTotal: 0, rowsError: 0 })
    .returning();
  return { user, account, importId: imp.id };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function seed(ctx: Ctx, count: number): Promise<string[]> {
  const rows = await db
    .insert(transactions)
    .values(
      Array.from({ length: count }, () => {
        seq += 1;
        return {
          userId: ctx.user.id,
          accountId: ctx.account.id,
          importId: ctx.importId,
          date: "2025-01-01",
          amountCents: -100,
          labelRaw: `L${seq}`,
          labelNormalized: normalizeLabel(`L${seq}`),
          labelDisplay: `L${seq}`,
          dedupeHash: `tag-${seq}`,
          occurrenceIndex: 0,
        };
      }),
    )
    .returning({ id: transactions.id });
  return rows.map((r) => r.id);
}

const names = (list: { name: string }[]) => list.map((t) => t.name);

describe("tags", () => {
  beforeEach(resetDb);

  it("reuses a tag case-insensitively and lists with counts, sorted by name", async () => {
    const ctx = await setup();
    const [a, b] = await seed(ctx, 2);
    await addTagsToTransaction(db, ctx.user.id, a, ["zebra", "Holidays 2026"]);
    const res = await addTagsToTransaction(db, ctx.user.id, b, ["holidays 2026", "apple"]);
    expect(res.ok && names(res.tags)).toEqual(["apple", "Holidays 2026"]);
    const listed = await listTags(db, ctx.user.id);
    expect(listed.map((t) => [t.name, t.transactionCount])).toEqual([
      ["apple", 1],
      ["Holidays 2026", 2],
      ["zebra", 1],
    ]);
  });

  it("lists an unused tag with 0", async () => {
    const ctx = await setup();
    await db.transaction((tx) => getOrCreateTags(tx, ctx.user.id, ["Lonely"]));
    expect((await listTags(db, ctx.user.id)).map((t) => [t.name, t.transactionCount])).toEqual([["Lonely", 0]]);
  });

  it("enforces 10 tags per transaction, creating nothing on refusal", async () => {
    const ctx = await setup();
    const [id] = await seed(ctx, 1);
    const ten = Array.from({ length: MAX_TAGS_PER_TRANSACTION }, (_, i) => `t${i}`);
    expect((await addTagsToTransaction(db, ctx.user.id, id, ten)).ok).toBe(true);
    const over = await addTagsToTransaction(db, ctx.user.id, id, ["t0", "eleven"]);
    expect(over).toEqual({ ok: false, code: "tooManyTags" });
    expect(await listTags(db, ctx.user.id)).toHaveLength(10);
    // Re-adding an existing one is fine.
    expect((await addTagsToTransaction(db, ctx.user.id, id, ["T3"])).ok).toBe(true);
  });

  it("enforces 200 tags per user", async () => {
    const ctx = await setup();
    const many = Array.from({ length: MAX_TAGS_PER_USER }, (_, i) => `n${i}`);
    expect((await db.transaction((tx) => getOrCreateTags(tx, ctx.user.id, many))).ok).toBe(true);
    const over = await db.transaction((tx) => getOrCreateTags(tx, ctx.user.id, ["extra"]));
    expect(over).toEqual({ ok: false, code: "tooManyUserTags" });
    const reuse = await db.transaction((tx) => getOrCreateTags(tx, ctx.user.id, ["N5"]));
    expect(reuse.ok).toBe(true);
  });

  it("ignores another user's transaction", async () => {
    const a = await setup();
    const b = await setup();
    const [bTx] = await seed(b, 1);
    expect(await addTagsToTransaction(db, a.user.id, bTx, ["x"])).toEqual({ ok: false, code: "notFound" });
    expect(await listTags(db, a.user.id)).toEqual([]);
  });

  it("removes a tag from a transaction, only for its owner", async () => {
    const a = await setup();
    const b = await setup();
    const [tx] = await seed(a, 1);
    const res = await addTagsToTransaction(db, a.user.id, tx, ["x"]);
    if (!res.ok) throw new Error(res.code);
    expect(await removeTagFromTransaction(db, b.user.id, tx, res.tags[0].id)).toBe(false);
    expect(await removeTagFromTransaction(db, a.user.id, tx, res.tags[0].id)).toBe(true);
    expect((await loadTransactionTags(db, a.user.id, [tx])).get(tx)).toBeUndefined();
  });

  describe("rename and delete", () => {
    it("renames, allows a case change, and refuses another tag's name", async () => {
      const ctx = await setup();
      const created = await db.transaction((tx) => getOrCreateTags(tx, ctx.user.id, ["Alpha", "Beta"]));
      if (!created.ok) throw new Error(created.code);
      const alpha = created.tags.find((t) => t.name === "Alpha")!;
      expect(await renameTag(db, ctx.user.id, alpha.id, "beta")).toEqual({ ok: false, code: "conflict" });
      expect(await renameTag(db, ctx.user.id, alpha.id, "ALPHA")).toEqual({ ok: true, tag: { id: alpha.id, name: "ALPHA" } });
      expect(await renameTag(db, ctx.user.id, alpha.id, "Gamma")).toMatchObject({ ok: true });
      expect(names(await listTags(db, ctx.user.id))).toEqual(["Beta", "Gamma"]);
    });

    it("says notFound for another user's tag and leaves it untouched", async () => {
      const a = await setup();
      const b = await setup();
      const created = await db.transaction((tx) => getOrCreateTags(tx, a.user.id, ["Mine"]));
      if (!created.ok) throw new Error(created.code);
      const id = created.tags[0].id;
      expect(await renameTag(db, b.user.id, id, "Stolen")).toEqual({ ok: false, code: "notFound" });
      expect(await deleteTag(db, b.user.id, id)).toBeNull();
      expect(names(await listTags(db, a.user.id))).toEqual(["Mine"]);
    });

    it("allows the same name for two users", async () => {
      const a = await setup();
      const b = await setup();
      await db.transaction((tx) => getOrCreateTags(tx, a.user.id, ["Same"]));
      const other = await db.transaction((tx) => getOrCreateTags(tx, b.user.id, ["same"]));
      expect(other.ok).toBe(true);
    });

    it("delete drops the links but keeps the transactions", async () => {
      const ctx = await setup();
      const [tx] = await seed(ctx, 1);
      const res = await addTagsToTransaction(db, ctx.user.id, tx, ["gone", "kept"]);
      if (!res.ok) throw new Error(res.code);
      const gone = res.tags.find((t) => t.name === "gone")!;
      expect(await deleteTag(db, ctx.user.id, gone.id)).toMatchObject({ tag: { id: gone.id } });
      expect(names((await loadTransactionTags(db, ctx.user.id, [tx])).get(tx) ?? [])).toEqual(["kept"]);
      expect(await db.select().from(transactions).where(eq(transactions.id, tx))).toHaveLength(1);
    });
  });

  describe("delete with Undo", () => {
    it("restore recreates the tag with its id and re-links the transactions that remain", async () => {
      const ctx = await setup();
      const [t1, t2, t3] = await seed(ctx, 3);
      for (const id of [t1, t2, t3]) await addTagsToTransaction(db, ctx.user.id, id, ["Trip"]);
      const [tag] = await listTags(db, ctx.user.id);
      const snapshot = await deleteTag(db, ctx.user.id, tag.id);
      expect(snapshot?.tag).toEqual({ id: tag.id, name: "Trip" });
      expect(new Set(snapshot?.transactionIds)).toEqual(new Set([t1, t2, t3]));
      expect(await listTags(db, ctx.user.id)).toEqual([]);

      // One of the transactions disappears before Undo.
      await db.delete(transactions).where(eq(transactions.id, t3));
      if (!snapshot) throw new Error("no snapshot");
      expect(await restoreTag(db, ctx.user.id, snapshot)).toEqual({ ok: true, linked: 2 });
      expect(await listTags(db, ctx.user.id)).toEqual([{ id: tag.id, name: "Trip", transactionCount: 2 }]);
    });

    it("refuses when a tag with that name exists again, and never links another user's transactions", async () => {
      const a = await setup();
      const b = await setup();
      const [mine] = await seed(a, 1);
      const [theirs] = await seed(b, 1);
      await addTagsToTransaction(db, a.user.id, mine, ["Trip"]);
      const [tag] = await listTags(db, a.user.id);
      const snapshot = await deleteTag(db, a.user.id, tag.id);
      if (!snapshot) throw new Error("no snapshot");

      await addTagsToTransaction(db, a.user.id, mine, ["trip"]);
      expect(await restoreTag(db, a.user.id, snapshot)).toEqual({ ok: false, code: "conflict" });

      const c = await setup();
      const d = await setup();
      const [dTx] = await seed(d, 1);
      expect(
        await restoreTag(db, c.user.id, { tag: { id: crypto.randomUUID(), name: "Trip" }, transactionIds: [dTx, theirs] }),
      ).toEqual({ ok: true, linked: 0 });
      expect(await db.select().from(transactionTags).where(eq(transactionTags.userId, d.user.id))).toHaveLength(0);
    });
  });

  describe("bulk", () => {
    it("adds a tag, counting created links; already tagged rows are no-ops, full rows skipped", async () => {
      const ctx = await setup();
      const [plain, already, full] = await seed(ctx, 3);
      await addTagsToTransaction(db, ctx.user.id, already, ["Trip"]);
      await addTagsToTransaction(
        db,
        ctx.user.id,
        full,
        Array.from({ length: MAX_TAGS_PER_TRANSACTION }, (_, i) => `f${i}`),
      );
      const res = await bulkAddTag(db, ctx.user.id, [plain, already, full], "trip");
      expect(res).toMatchObject({ ok: true, updated: 1, skipped: 1 });
      expect((await listTags(db, ctx.user.id)).find((t) => t.name === "Trip")?.transactionCount).toBe(2);
    });

    it("ignores foreign ids and creates nothing when none is owned", async () => {
      const a = await setup();
      const b = await setup();
      const [bTx] = await seed(b, 1);
      expect(await bulkAddTag(db, a.user.id, [bTx], "x")).toEqual({ ok: true, updated: 0, skipped: 0, tag: null });
      expect(await listTags(db, a.user.id)).toEqual([]);
      const [aTx] = await seed(a, 1);
      expect(await bulkAddTag(db, a.user.id, [aTx, bTx], "x")).toMatchObject({ ok: true, updated: 1, skipped: 0 });
      expect((await loadTransactionTags(db, b.user.id, [bTx])).size).toBe(0);
    });

    it("refuses more than 500 ids", async () => {
      const ctx = await setup();
      const ids = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      expect(await bulkAddTag(db, ctx.user.id, ids, "x")).toEqual({ ok: false, code: "tooManyRows" });
    });

    it("removes a tag from the selection only", async () => {
      const ctx = await setup();
      const [a, b, c] = await seed(ctx, 3);
      for (const id of [a, b, c]) await addTagsToTransaction(db, ctx.user.id, id, ["Trip"]);
      const [{ id: tagId }] = await listTags(db, ctx.user.id);
      expect(await bulkRemoveTag(db, ctx.user.id, [a, b], tagId)).toEqual({ updated: 2 });
      expect(await bulkRemoveTag(db, ctx.user.id, [a, b], tagId)).toEqual({ updated: 0 });
      expect((await listTags(db, ctx.user.id))[0].transactionCount).toBe(1);
      const other = await setup();
      expect(await bulkRemoveTag(db, other.user.id, [c], tagId)).toEqual({ updated: 0 });
    });
  });

  describe("notes", () => {
    it("sets and clears a note for the owner only", async () => {
      const a = await setup();
      const b = await setup();
      const [tx] = await seed(a, 1);
      expect(await setTransactionNote(db, b.user.id, tx, "nope")).toBe(false);
      expect(await setTransactionNote(db, a.user.id, tx, "hello\nworld")).toBe(true);
      const read = () => db.select({ note: transactions.note }).from(transactions).where(eq(transactions.id, tx));
      expect((await read())[0].note).toBe("hello\nworld");
      expect(await setTransactionNote(db, a.user.id, tx, null)).toBe(true);
      expect((await read())[0].note).toBeNull();
    });
  });

  describe("cascades and constraints", () => {
    it("undoing an import drops the links but keeps the tags", async () => {
      const ctx = await setup();
      const [tx] = await seed(ctx, 1);
      await addTagsToTransaction(db, ctx.user.id, tx, ["Trip"]);
      await undoImport(db, ctx.user.id, ctx.importId);
      expect(await db.select().from(transactionTags)).toHaveLength(0);
      expect((await listTags(db, ctx.user.id)).map((t) => [t.name, t.transactionCount])).toEqual([["Trip", 0]]);
    });

    it("rejects a link between a user's transaction and another user's tag", async () => {
      const a = await setup();
      const b = await setup();
      const [aTx] = await seed(a, 1);
      const [bTag] = await db.insert(tags).values({ userId: b.user.id, name: "B" }).returning();
      await expect(
        db.insert(transactionTags).values({ transactionId: aTx, tagId: bTag.id, userId: a.user.id }),
      ).rejects.toThrow();
    });
  });
});
