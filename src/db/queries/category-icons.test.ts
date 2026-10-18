// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { categories, imports, transactions } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { listAccounts } from "./accounts";
import { createCategory, listCategoryOptions, updateCategory } from "./categories";
import { createRule, listRules } from "./category-rules";
import { getSpendingByCategory, getSubcategorySpending } from "./dashboard";
import { provisionUserDefaults } from "./provision";
import { listRecurring, refreshRecurring } from "./recurring";
import { listTransactions, setTransactionCategory } from "./transactions";

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

async function newCategory(userId: string, name: string, extra: { icon?: string | null; parentId?: string } = {}) {
  const r = await createCategory(db, userId, { name, color: "#112233", ...extra });
  if (!r.ok) throw new Error(r.error);
  return r.category;
}

let seq = 0;
async function addTx(ctx: Ctx, date: string, amountCents: number, categoryId: string | null, label = "SHOP") {
  seq += 1;
  const [row] = await db
    .insert(transactions)
    .values({
      userId: ctx.user.id,
      accountId: ctx.account.id,
      importId: ctx.importId,
      date,
      amountCents,
      labelRaw: label,
      labelNormalized: label,
      labelDisplay: label,
      categoryId,
      dedupeHash: `icon-${seq}`,
      occurrenceIndex: 0,
    })
    .returning();
  return row;
}

const ALL = { q: "", direction: "all", category: null, from: null, to: null, account: null } as never;

describe("category icons", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("saves the icon on create and update, keeps it when omitted, and clears it with null", async () => {
    const { user } = await setup();
    const pets = await newCategory(user.id, "Pets", { icon: "🐶" });
    expect(pets.icon).toBe("🐶");

    const renamed = await updateCategory(db, user.id, pets.id, { name: "Animals", color: "#112233" });
    expect(renamed).toMatchObject({ ok: true, category: { name: "Animals", icon: "🐶" } });

    const changed = await updateCategory(db, user.id, pets.id, { name: "Animals", color: "#112233", icon: "🐱" });
    expect(changed).toMatchObject({ ok: true, category: { icon: "🐱" } });

    const cleared = await updateCategory(db, user.id, pets.id, { name: "Animals", color: "#112233", icon: null });
    expect(cleared).toMatchObject({ ok: true, category: { icon: null } });
  });

  it("starts without an icon by default", async () => {
    const { user } = await setup();
    expect((await newCategory(user.id, "Plain")).icon).toBeNull();
  });

  it("does not let another user change a category's icon", async () => {
    const a = await setup();
    const b = await setup();
    const mine = await newCategory(a.user.id, "Mine", { icon: "🏠" });
    const result = await updateCategory(db, b.user.id, mine.id, { name: "Mine", color: "#112233", icon: "💥" });
    expect(result).toEqual({ ok: false, error: "not_found" });
    const [row] = await db.select().from(categories).where(eq(categories.id, mine.id));
    expect(row.icon).toBe("🏠");
  });

  it("puts each category's own icon in picker option labels", async () => {
    const { user } = await setup();
    const housing = await newCategory(user.id, "Housing", { icon: "🏠" });
    await newCategory(user.id, "Furniture", { parentId: housing.id, icon: "🛋️" });
    await newCategory(user.id, "Rent", { parentId: housing.id });
    const options = await listCategoryOptions(user.id, "en");
    expect(options.map((o) => [o.label, o.icon])).toEqual([
      ["🏠 Housing", "🏠"],
      ["🏠 Housing > 🛋️ Furniture", "🛋️"],
      ["🏠 Housing > Rent", null],
    ]);
  });

  it("returns subcategory icons on transaction rows and after categorizing", async () => {
    const ctx = await setup();
    const housing = await newCategory(ctx.user.id, "Housing", { icon: "🏠" });
    const rent = await newCategory(ctx.user.id, "Rent", { parentId: housing.id });
    await addTx(ctx, "2025-09-04", -100, housing.id, "HOME");
    const sofa = await newCategory(ctx.user.id, "Sofa", { parentId: housing.id, icon: "🛋️" });
    const rentTx = await addTx(ctx, "2025-09-03", -100, rent.id, "RENT");
    await addTx(ctx, "2025-09-02", -100, sofa.id, "SOFA");
    await addTx(ctx, "2025-09-01", -100, null, "NONE");

    const { items } = await listTransactions(db, ctx.user.id, ALL, null);
    expect(items.map((i) => [i.label, i.category?.icon ?? null])).toEqual([
      ["HOME", "🏠"],
      ["RENT", null],
      ["SOFA", "🛋️"],
      ["NONE", null],
    ]);

    expect((await setTransactionCategory(db, ctx.user.id, rentTx.id, rent.id))?.category?.icon).toBeNull();
    expect((await setTransactionCategory(db, ctx.user.id, rentTx.id, sofa.id))?.category?.icon).toBe("🛋️");
    expect((await setTransactionCategory(db, ctx.user.id, rentTx.id, housing.id))?.category?.icon).toBe("🏠");
  });

  it("returns each rule's category icon", async () => {
    const ctx = await setup();
    const housing = await newCategory(ctx.user.id, "Housing", { icon: "🏠" });
    const rent = await newCategory(ctx.user.id, "Rent", { parentId: housing.id, icon: "🔑" });
    await createRule(db, ctx.user.id, { categoryId: housing.id, matchType: "contains", pattern: "home" });
    await createRule(db, ctx.user.id, { categoryId: rent.id, matchType: "contains", pattern: "rent" });
    expect((await listRules(db, ctx.user.id)).map((r) => r.categoryIcon)).toEqual(["🏠", "🔑"]);
  });

  it("uses the parent's icon for the dashboard roll-up and each subcategory's own in the drill-down", async () => {
    const ctx = await setup();
    const housing = await newCategory(ctx.user.id, "Housing", { icon: "🏠" });
    const rent = await newCategory(ctx.user.id, "Rent", { parentId: housing.id, icon: "🔑" });
    const sofa = await newCategory(ctx.user.id, "Sofa", { parentId: housing.id });
    const plain = await newCategory(ctx.user.id, "Plain");
    const bare = await newCategory(ctx.user.id, "Bare");
    const bareChild = await newCategory(ctx.user.id, "BareChild", { parentId: bare.id, icon: "🧸" });
    await addTx(ctx, "2025-09-03", -300, rent.id);
    await addTx(ctx, "2025-09-04", -200, sofa.id);
    await addTx(ctx, "2025-09-07", -10, housing.id);
    await addTx(ctx, "2025-09-05", -50, plain.id);
    await addTx(ctx, "2025-09-06", -20, bareChild.id);
    const range = { from: "2025-09-01", to: "2025-09-30" };

    const top = await getSpendingByCategory(db, ctx.user.id, range);
    // A child's own icon never leaks into its parent's slice, and a child never splits it in two.
    expect(top.map((r) => [r.name, r.icon, r.spentCents])).toEqual([
      ["Housing", "🏠", 510],
      ["Plain", null, 50],
      ["Bare", null, 20],
    ]);

    const buckets = await getSubcategorySpending(db, ctx.user.id, range, housing.id);
    expect(buckets?.map((b) => [b.name, b.icon])).toEqual([
      ["Rent", "🔑"],
      ["Sofa", null],
      ["Housing", "🏠"],
    ]);
  });

  it("shows on a recurring item the icon of its latest charge's category", async () => {
    const ctx = await setup();
    const media = await newCategory(ctx.user.id, "Media", { icon: "🎬" });
    const stream = await newCategory(ctx.user.id, "Streaming", { parentId: media.id, icon: "📺" });
    await addTx(ctx, "2025-07-05", -1299, null, "NETFLIX");
    await addTx(ctx, "2025-08-05", -1299, null, "NETFLIX");
    const latest = await addTx(ctx, "2025-09-05", -1299, null, "NETFLIX");
    await refreshRecurring(db, ctx.user.id);
    expect((await listRecurring(db, ctx.user.id))[0].categoryIcon).toBeNull();

    await setTransactionCategory(db, ctx.user.id, latest.id, stream.id);
    expect((await listRecurring(db, ctx.user.id))[0].categoryIcon).toBe("📺");

    await setTransactionCategory(db, ctx.user.id, latest.id, media.id);
    expect((await listRecurring(db, ctx.user.id))[0].categoryIcon).toBe("🎬");
  });
});
