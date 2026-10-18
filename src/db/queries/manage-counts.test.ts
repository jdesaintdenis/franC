// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { categories, tags } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { getManageCounts } from "./manage-counts";

describe("getManageCounts", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("counts top-level and sub categories and tags, scoped by user", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const [food] = await db.insert(categories).values({ userId: a.id, name: "Food", color: "#112233" }).returning();
    await db.insert(categories).values([
      { userId: a.id, name: "Cafés", color: "#112233", parentId: food.id },
      { userId: a.id, name: "Home", color: "#112233" },
      { userId: b.id, name: "Other", color: "#112233" },
    ]);
    await db.insert(tags).values([{ userId: a.id, name: "Trip" }, { userId: b.id, name: "Work" }]);

    expect(await getManageCounts(db, a.id)).toEqual({
      topCategories: 2,
      subCategories: 1,
      rules: 0,
      merchants: 0,
      tags: 1,
      bankMappings: 0,
    });
    expect((await getManageCounts(db, b.id)).topCategories).toBe(1);
  });
});
