// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../client";
import { resetDb } from "../test-utils";
import { getBackupStatus, recordBackupRun } from "./backup-status";

const D1 = new Date("2026-10-17T07:00:00Z");
const D2 = new Date("2026-10-18T07:00:00Z");
const D3 = new Date("2026-10-19T07:00:00Z");

describe("backup status", () => {
  beforeEach(resetDb);

  it("is null before the first run", async () => {
    expect(await getBackupStatus(db)).toBeNull();
  });

  it("keeps the first failure date, then a success clears it", async () => {
    await recordBackupRun(db, { at: D1, error: "upload" });
    await recordBackupRun(db, { at: D2, error: "dump" });
    expect(await getBackupStatus(db)).toEqual({ failingSince: D1, lastSuccessAt: null });

    await recordBackupRun(db, { at: D3, error: null, pathname: "backups/x", sizeBytes: 5 });
    expect(await getBackupStatus(db)).toEqual({ failingSince: null, lastSuccessAt: D3 });
  });

  it("a later failure keeps the last success date", async () => {
    await recordBackupRun(db, { at: D1, error: null });
    await recordBackupRun(db, { at: D2, error: "dump" });
    expect(await getBackupStatus(db)).toEqual({ failingSince: D2, lastSuccessAt: D1 });
  });
});
