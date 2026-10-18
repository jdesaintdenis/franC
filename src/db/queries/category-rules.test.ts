// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { imports, transactions } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { listAccounts } from "./accounts";
import { createCategory } from "./categories";
import {
  applyRulesToUncategorized,
  createRule,
  deleteRule,
  listRules,
  reorderRules,
  restoreRule,
  undoRule,
  updateRule,
} from "./category-rules";
import { provisionUserDefaults } from "./provision";

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [account] = await listAccounts(user.id);
  const cat = async (name: string) => {
    const r = await createCategory(db, user.id, { name, color: "#112233" });
    if (!r.ok) throw new Error(r.error);
    return r.category;
  };
  return { user, account, cat };
}

async function rule(
  userId: string,
  categoryId: string,
  pattern: string,
  matchType: "contains" | "equals" | "regex" = "contains",
) {
  const created = await createRule(db, userId, {
    categoryId,
    matchType,
    pattern,
  });
  if (!created) throw new Error("rule not created");
  return created;
}

describe("category rules queries", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("appends new rules with increasing priority and lists them with category info", async () => {
    const { user, cat } = await setup();
    const telecom = await cat("Telecom");
    const a = await rule(user.id, telecom.id, "orange");
    const b = await rule(user.id, telecom.id, "free");
    expect([a.priority, b.priority]).toEqual([0, 1]);

    const listed = await listRules(db, user.id);
    expect(listed.map((r) => r.pattern)).toEqual(["orange", "free"]);
    expect(listed[0]).toMatchObject({
      categoryName: "Telecom",
      categoryColor: "#112233",
    });
  });

  it("updates and deletes a rule", async () => {
    const { user, cat } = await setup();
    const a = await cat("A");
    const b = await cat("B");
    const created = await rule(user.id, a.id, "orange");

    const updated = await updateRule(db, user.id, created.id, {
      categoryId: b.id,
      matchType: "equals",
      pattern: "ORANGE",
    });
    expect(updated).toMatchObject({
      categoryId: b.id,
      matchType: "equals",
      pattern: "ORANGE",
      priority: created.priority,
    });

    expect(await deleteRule(db, user.id, created.id)).toMatchObject({ id: created.id });
    expect(await deleteRule(db, user.id, created.id)).toBeNull();
    expect(await listRules(db, user.id)).toHaveLength(0);
  });

  it("reorders only with the exact full set of ids", async () => {
    const { user, cat } = await setup();
    const c = await cat("C");
    const r0 = await rule(user.id, c.id, "a");
    const r1 = await rule(user.id, c.id, "b");
    const r2 = await rule(user.id, c.id, "c");

    expect(await reorderRules(db, user.id, [r0.id, r1.id])).toBe(false);
    expect(await reorderRules(db, user.id, [r0.id, r1.id, r1.id])).toBe(false);
    expect(await reorderRules(db, user.id, [r0.id, r1.id, r2.id, r2.id])).toBe(false);
    expect((await listRules(db, user.id)).map((r) => r.pattern)).toEqual(["a", "b", "c"]);

    expect(await reorderRules(db, user.id, [r2.id, r0.id, r1.id])).toBe(true);
    const listed = await listRules(db, user.id);
    expect(listed.map((r) => [r.pattern, r.priority])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("applyRulesToUncategorized skips categorized rows (manual and rule) and reports what changed", async () => {
    const { user, account, cat } = await setup();
    const telecom = await cat("Telecom");
    const manualCat = await cat("Manual");
    const ruleCat = await cat("ByRule");
    await rule(user.id, telecom.id, "orange");

    const [imp] = await db
      .insert(imports)
      .values({
        userId: user.id,
        accountId: account.id,
        filename: "x.csv",
        rowsTotal: 4,
        rowsError: 0,
      })
      .returning();
    const base = {
      userId: user.id,
      accountId: account.id,
      importId: imp.id,
      date: "2025-09-29",
      amountCents: -6650,
    };
    const inserted = await db
      .insert(transactions)
      .values([
        {
          ...base,
          dedupeHash: "free",
          occurrenceIndex: 0,
          labelNormalized: "PRLV ORANGE BOX",
          labelDisplay: "ORANGE",
        },
        {
          ...base,
          dedupeHash: "display",
          occurrenceIndex: 0,
          labelNormalized: null,
          labelDisplay: "Orange Bank",
        },
        {
          ...base,
          dedupeHash: "manual",
          occurrenceIndex: 0,
          labelNormalized: "ORANGE",
          labelDisplay: "ORANGE",
          categoryId: manualCat.id,
          categorySource: "manual",
        },
        {
          ...base,
          dedupeHash: "ruled",
          occurrenceIndex: 0,
          labelNormalized: "ORANGE",
          labelDisplay: "ORANGE",
          categoryId: ruleCat.id,
          categorySource: "rule",
        },
        {
          ...base,
          dedupeHash: "other",
          occurrenceIndex: 0,
          labelNormalized: "CB SNACK DU PORT",
          labelDisplay: "SNACK",
        },
      ])
      .returning();
    const idOf = (hash: string) => inserted.find((t) => t.dedupeHash === hash)!.id;

    const result = await applyRulesToUncategorized(db, user.id);
    expect(result.updated).toBe(2);
    expect(Object.keys(result.byCategory)).toEqual([telecom.id]);
    expect([...result.byCategory[telecom.id]].sort()).toEqual([idOf("free"), idOf("display")].sort());

    const rows = await db.select().from(transactions).where(eq(transactions.userId, user.id));
    const get = (hash: string) => rows.find((t) => t.dedupeHash === hash);
    expect(get("free")).toMatchObject({
      categoryId: telecom.id,
      categorySource: "rule",
    });
    expect(get("display")).toMatchObject({
      categoryId: telecom.id,
      categorySource: "rule",
    });
    expect(get("manual")).toMatchObject({
      categoryId: manualCat.id,
      categorySource: "manual",
    });
    expect(get("ruled")).toMatchObject({
      categoryId: ruleCat.id,
      categorySource: "rule",
    });
    expect(get("other")).toMatchObject({
      categoryId: null,
      categorySource: null,
    });

    expect(await applyRulesToUncategorized(db, user.id)).toEqual({
      updated: 0,
      byCategory: {},
    });
  });

  it("undoRule deletes the rule and clears only rows still set by it", async () => {
    const { user, account, cat } = await setup();
    const food = await cat("Eats");
    const other = await cat("Hobbies");
    const r = await rule(user.id, food.id, "carrefour");
    const [imp] = await db
      .insert(imports)
      .values({ userId: user.id, accountId: account.id, filename: "x.csv", rowsTotal: 0, rowsError: 0 })
      .returning();
    const mk = (n: number, categoryId: string, categorySource: "rule" | "manual") => ({
      userId: user.id,
      accountId: account.id,
      importId: imp.id,
      date: "2025-01-01",
      amountCents: -100,
      labelRaw: `L${n}`,
      labelNormalized: `l${n}`,
      dedupeHash: `h${n}`,
      occurrenceIndex: 0,
      categoryId,
      categorySource,
    });
    const rows = await db
      .insert(transactions)
      .values([mk(1, food.id, "rule"), mk(2, food.id, "manual"), mk(3, other.id, "rule")])
      .returning({ id: transactions.id });
    const ids = rows.map((x) => x.id);

    const result = await undoRule(db, user.id, r.id, ids);
    expect(result?.cleared).toEqual([ids[0]]);
    expect(await listRules(db, user.id)).toEqual([]);
    const after = await db.select().from(transactions).where(eq(transactions.userId, user.id));
    const byId = new Map(after.map((t) => [t.id, t]));
    expect(byId.get(ids[0])).toMatchObject({ categoryId: null, categorySource: null });
    expect(byId.get(ids[1])).toMatchObject({ categoryId: food.id, categorySource: "manual" });
    expect(byId.get(ids[2])).toMatchObject({ categoryId: other.id, categorySource: "rule" });
  });

  it("undoRule ignores another user's rule and rows", async () => {
    const a = await setup();
    const b = await setup();
    const food = await b.cat("Eats");
    const r = await rule(b.user.id, food.id, "carrefour");
    expect(await undoRule(db, a.user.id, r.id, [])).toBeNull();
    expect(await listRules(db, b.user.id)).toHaveLength(1);
  });

  it("delete returns a snapshot and restore puts the rule back at its priority, shifting the others", async () => {
    const { user, cat } = await setup();
    const food = await cat("Eats");
    const r1 = await rule(user.id, food.id, "one");
    const r2 = await rule(user.id, food.id, "two");
    const r3 = await rule(user.id, food.id, "three");
    const snapshot = await deleteRule(db, user.id, r2.id);
    expect(snapshot).toEqual({
      id: r2.id,
      categoryId: food.id,
      matchType: "contains",
      pattern: "two",
      priority: r2.priority,
    });
    expect((await listRules(db, user.id)).map((r) => r.pattern)).toEqual(["one", "three"]);
    if (!snapshot) throw new Error("no snapshot");
    expect(await restoreRule(db, user.id, snapshot)).toMatchObject({ ok: true, rule: { id: r2.id } });
    const after = await listRules(db, user.id);
    expect(after.map((r) => r.pattern)).toEqual(["one", "two", "three"]);
    expect(after.map((r) => r.id)).toEqual([r1.id, r2.id, r3.id]);
  });

  it("restore refuses a category that isn't the user's or an id that exists", async () => {
    const a = await setup();
    const b = await setup();
    const mine = await a.cat("Mine");
    const theirs = await b.cat("Theirs");
    const r = await rule(a.user.id, mine.id, "x");
    const snapshot = { id: r.id, categoryId: mine.id, matchType: "contains" as const, pattern: "x", priority: r.priority };
    expect(await restoreRule(db, a.user.id, snapshot)).toEqual({ ok: false, error: "conflict" });
    expect(await restoreRule(db, a.user.id, { ...snapshot, id: crypto.randomUUID(), categoryId: theirs.id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await restoreRule(db, b.user.id, { ...snapshot, id: crypto.randomUUID() })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await listRules(db, a.user.id)).toHaveLength(1);
  });
});
