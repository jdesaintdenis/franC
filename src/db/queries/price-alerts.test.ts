// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { imports, recurring, recurringPriceAlerts, transactions } from "../schema";
import { createTestUser, resetDb, seedCategories } from "../test-utils";
import { listAccounts } from "./accounts";
import { undoImport } from "./imports";
import { acceptPriceAlert, dismissPriceAlert, listOpenPriceAlerts } from "./price-alerts";
import { provisionUserDefaults } from "./provision";
import { listRecurring, refreshRecurring } from "./recurring";

interface Row {
  date: string;
  amountCents: number;
  label: string;
}

async function setup() {
  const user = await createTestUser();
  await provisionUserDefaults(db, user.id);
  await seedCategories(user.id);
  const [account] = await listAccounts(user.id);
  return { user, account };
}

let hashCounter = 0;

async function seed(userId: string, accountId: string, rows: Row[]): Promise<string> {
  const [imp] = await db
    .insert(imports)
    .values({ userId, accountId, filename: "x.csv", rowsTotal: rows.length, rowsError: 0 })
    .returning();
  await db.insert(transactions).values(
    rows.map((r) => ({
      userId,
      accountId,
      importId: imp.id,
      date: r.date,
      amountCents: r.amountCents,
      labelRaw: r.label,
      labelNormalized: r.label,
      labelDisplay: `Display ${r.label}`,
      dedupeHash: `pa${hashCounter++}`,
      occurrenceIndex: 0,
    })),
  );
  return imp.id;
}

const LABEL = "PRLV NETFLIX";
const before: Row[] = [
  { date: "2025-06-05", amountCents: -1349, label: LABEL },
  { date: "2025-07-05", amountCents: -1349, label: LABEL },
  { date: "2025-08-05", amountCents: -1349, label: LABEL },
];
const higher: Row = { date: "2025-09-05", amountCents: -1599, label: LABEL };

async function itemOf(userId: string) {
  const [row] = await db.select().from(recurring).where(eq(recurring.userId, userId));
  return row;
}

describe("price alerts", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("raises one alert for a higher charge and nothing new on a second refresh", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, before);
    await refreshRecurring(db, user.id);
    expect(await listOpenPriceAlerts(db, user.id)).toEqual([]);

    await seed(user.id, account.id, [higher]);
    const first = await refreshRecurring(db, user.id);
    expect(first.priceAlerts).toBe(1);
    const second = await refreshRecurring(db, user.id);
    expect(second.priceAlerts).toBe(0);

    const alerts = await listOpenPriceAlerts(db, user.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      name: `Display ${LABEL}`,
      accountId: account.id,
      oldAmountCents: -1349,
      newAmountCents: -1599,
      chargedOn: "2025-09-05",
    });
    expect((await listRecurring(db, user.id))[0].hasPriceAlert).toBe(true);
    expect(await listOpenPriceAlerts(db, user.id, { accountId: account.id })).toHaveLength(1);
  });

  it("keeps a detected item and its usual amount while an alert is open", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, before);
    await refreshRecurring(db, user.id);
    await seed(user.id, account.id, [higher]);
    await refreshRecurring(db, user.id);

    const item = await itemOf(user.id);
    expect(item.status).toBe("detected");
    expect(item.typicalAmountCents).toBe(-1349);
    expect(item.lastSeenDate).toBe("2025-09-05");
  });

  it("accept sets the usual amount, confirms, and never re-raises that charge", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, before);
    await refreshRecurring(db, user.id);
    await seed(user.id, account.id, [higher]);
    await refreshRecurring(db, user.id);
    const [alert] = await listOpenPriceAlerts(db, user.id);

    const accepted = await acceptPriceAlert(db, user.id, alert.id);
    expect(accepted?.status).toBe("accepted");
    expect(accepted?.resolvedAt).not.toBeNull();
    const item = await itemOf(user.id);
    expect(item.typicalAmountCents).toBe(-1599);
    expect(item.status).toBe("confirmed");

    expect((await refreshRecurring(db, user.id)).priceAlerts).toBe(0);
    expect(await listOpenPriceAlerts(db, user.id)).toEqual([]);
    expect(await acceptPriceAlert(db, user.id, alert.id)).toBeNull();
  });

  it("dismiss keeps the usual amount and does not re-raise the same charge", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, before);
    await refreshRecurring(db, user.id);
    await seed(user.id, account.id, [higher]);
    await refreshRecurring(db, user.id);
    const [alert] = await listOpenPriceAlerts(db, user.id);

    expect((await dismissPriceAlert(db, user.id, alert.id))?.status).toBe("dismissed");
    expect((await itemOf(user.id)).typicalAmountCents).toBe(-1349);
    expect((await refreshRecurring(db, user.id)).priceAlerts).toBe(0);
    expect(await listOpenPriceAlerts(db, user.id)).toEqual([]);
    expect(await dismissPriceAlert(db, user.id, alert.id)).toBeNull();
  });

  it("dismissing covers one charge only: a higher next charge alerts again", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, before);
    await refreshRecurring(db, user.id);
    await seed(user.id, account.id, [higher]);
    await refreshRecurring(db, user.id);
    const [alert] = await listOpenPriceAlerts(db, user.id);
    await dismissPriceAlert(db, user.id, alert.id);

    await seed(user.id, account.id, [{ date: "2025-10-05", amountCents: -1599, label: LABEL }]);
    expect((await refreshRecurring(db, user.id)).priceAlerts).toBe(1);
  });

  it("clears an open alert when the next charge is back to normal", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, before);
    await refreshRecurring(db, user.id);
    await seed(user.id, account.id, [higher]);
    await refreshRecurring(db, user.id);
    await seed(user.id, account.id, [{ date: "2025-10-05", amountCents: -1349, label: LABEL }]);
    await refreshRecurring(db, user.id);
    expect(await listOpenPriceAlerts(db, user.id)).toEqual([]);
  });

  it("removes the alert when the import holding the charge is undone", async () => {
    const { user, account } = await setup();
    await seed(user.id, account.id, before);
    await refreshRecurring(db, user.id);
    const importId = await seed(user.id, account.id, [higher]);
    await refreshRecurring(db, user.id);
    expect(await listOpenPriceAlerts(db, user.id)).toHaveLength(1);

    await undoImport(db, user.id, importId);
    const rows = await db
      .select()
      .from(recurringPriceAlerts)
      .where(eq(recurringPriceAlerts.userId, user.id));
    expect(rows).toEqual([]);
    await refreshRecurring(db, user.id);
    expect(await listOpenPriceAlerts(db, user.id)).toEqual([]);
  });

  it("scopes list, accept and dismiss to the user", async () => {
    const { user, account } = await setup();
    const other = await createTestUser();
    await seed(user.id, account.id, before);
    await refreshRecurring(db, user.id);
    await seed(user.id, account.id, [higher]);
    await refreshRecurring(db, user.id);
    const [alert] = await listOpenPriceAlerts(db, user.id);

    expect(await listOpenPriceAlerts(db, other.id)).toEqual([]);
    expect(await acceptPriceAlert(db, other.id, alert.id)).toBeNull();
    expect(await dismissPriceAlert(db, other.id, alert.id)).toBeNull();
    const [row] = await db
      .select()
      .from(recurringPriceAlerts)
      .where(and(eq(recurringPriceAlerts.id, alert.id), eq(recurringPriceAlerts.userId, user.id)));
    expect(row.status).toBe("open");
  });
});
