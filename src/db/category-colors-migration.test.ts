// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { CATEGORY_PALETTE, subcategoryShade } from "@/lib/category-color";

import { db } from "./client";
import { categories } from "./schema";
import { createTestUser, resetDb } from "./test-utils";

/** Migration 0023 runs on an empty test DB, so re-run its statements on seeded rows. */
const statements = readFileSync(join(__dirname, "migrations/0023_tricolore_category_colors.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim());

async function runMigration() {
  for (const statement of statements) await db.execute(sql.raw(statement));
}

async function insert(userId: string, name: string, color: string, extra: { parentId?: string; icon?: string } = {}) {
  const [row] = await db
    .insert(categories)
    .values({ userId, name, color, ...extra })
    .returning({ id: categories.id });
  return row.id;
}

async function byName(userId: string) {
  const rows = await db.select().from(categories).where(eq(categories.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.name, { color: r.color, icon: r.icon }]));
}

describe("migration 0023 (Tricolore category colours)", () => {
  beforeEach(resetDb);

  it("recolours old default colours and gives known bank names an emoji", async () => {
    const user = await createTestUser();
    const alim = await insert(user.id, "Alimentation", "#2E7D32");
    await insert(user.id, "Hyper", "#1565C0", { parentId: alim });
    await insert(user.id, "Santé", "#EF6C00");
    await runMigration();
    expect(await byName(user.id)).toEqual({
      Alimentation: { color: CATEGORY_PALETTE[0], icon: "🛒" },
      Hyper: { color: subcategoryShade(CATEGORY_PALETTE[0], 0), icon: null },
      Santé: { color: CATEGORY_PALETTE[1], icon: "🩺" },
    });
  });

  it("keeps colours and emojis the user chose, and skips palette colours already in use", async () => {
    const user = await createTestUser();
    await insert(user.id, "Mine", CATEGORY_PALETTE[0]);
    await insert(user.id, "Transports", "#abcdef", { icon: "🚲" });
    await insert(user.id, "Old", "#455A64");
    await runMigration();
    expect(await byName(user.id)).toEqual({
      Mine: { color: CATEGORY_PALETTE[0], icon: null },
      Transports: { color: "#abcdef", icon: "🚲" },
      Old: { color: CATEGORY_PALETTE[1], icon: null },
    });
  });

  it("falls back to a palette colour when the parent isn't on the palette", async () => {
    const user = await createTestUser();
    const parent = await insert(user.id, "Custom", "#123456");
    await insert(user.id, "Child", "#5D4037", { parentId: parent });
    await runMigration();
    expect((await byName(user.id)).Child.color).toBe(CATEGORY_PALETTE[0]);
  });

  it("works per user", async () => {
    const [a, b] = [await createTestUser(), await createTestUser()];
    await insert(a.id, "X", "#2E7D32");
    await insert(b.id, "Y", "#2E7D32");
    await runMigration();
    expect((await byName(a.id)).X.color).toBe(CATEGORY_PALETTE[0]);
    expect((await byName(b.id)).Y.color).toBe(CATEGORY_PALETTE[0]);
  });
});
