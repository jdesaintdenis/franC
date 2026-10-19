// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { CsvMapping } from "../../lib/import/mapping";
import { db } from "../client";
import { accounts } from "../schema";
import { createTestUser, resetDb } from "../test-utils";
import { createAccount, listAccounts } from "./accounts";
import { loadMappingPrefill, saveMapping } from "./csv-mapping";
import { provisionUserDefaults } from "./provision";

const mapping = (label: string): CsvMapping => ({
  date: "Date",
  label,
  amount: { kind: "single", column: "Amount" },
  shortLabel: null,
  bookedOn: null,
  category: null,
  subcategory: null,
  dateFormat: "YYYY-MM-DD",
  decimal: ".",
});

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  const [first] = await listAccounts(user.id);
  const created = await createAccount(db, user.id, "Second");
  if (!created.ok) throw new Error(created.error);
  const second = created.account;
  return { user, first, second };
}

describe("csv mapping memory", () => {
  beforeEach(resetDb);

  it("starts empty", async () => {
    const { user, first } = await setup();
    expect(await loadMappingPrefill(db, user.id, first.id)).toEqual({ saved: null, latest: null });
  });

  it("returns this account's mapping and the newest one from another account", async () => {
    const { user, first, second } = await setup();
    await saveMapping(db, user.id, first.id, mapping("One"));
    await saveMapping(db, user.id, second.id, mapping("Two"));
    expect(await loadMappingPrefill(db, user.id, first.id)).toEqual({ saved: mapping("One"), latest: mapping("Two") });
    expect(await loadMappingPrefill(db, user.id, second.id)).toEqual({ saved: mapping("Two"), latest: mapping("One") });
  });

  it("overwrites on a new save", async () => {
    const { user, first } = await setup();
    await saveMapping(db, user.id, first.id, mapping("One"));
    await saveMapping(db, user.id, first.id, mapping("Three"));
    expect((await loadMappingPrefill(db, user.id, first.id)).saved).toEqual(mapping("Three"));
  });

  it("never reads or writes another user's account", async () => {
    const { user, first } = await setup();
    const stranger = await createTestUser();
    await provisionUserDefaults(db, stranger.id);
    const [theirs] = await listAccounts(stranger.id);
    await saveMapping(db, user.id, theirs.id, mapping("Hijack"));
    const [row] = await db.select().from(accounts).where(eq(accounts.id, theirs.id));
    expect(row.csvMapping).toBeNull();
    await saveMapping(db, stranger.id, theirs.id, mapping("Theirs"));
    expect(await loadMappingPrefill(db, user.id, first.id)).toEqual({ saved: null, latest: null });
  });

  it("ignores a stored mapping that no longer validates", async () => {
    const { user, first } = await setup();
    await db.update(accounts).set({ csvMapping: { nonsense: true } as never }).where(eq(accounts.id, first.id));
    expect((await loadMappingPrefill(db, user.id, first.id)).saved).toBeNull();
  });
});
