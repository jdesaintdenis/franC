import { generateIdentity, identityToRecipient } from "age-encryption";
import { describe, expect, it, vi } from "vitest";

import type { BackupArchive } from "./archive";
import { backupLogLine, isBackupConfigured, runDailyBackup, type BackupDeps } from "./daily";

const archive: BackupArchive = {
  format: "franc-backup",
  version: 1,
  createdAt: "2026-10-18T07:00:00.000Z",
  migrations: { count: 1, lastHash: "h" },
  tables: [{ name: "t", columns: ["a"], rowCount: 1, copy: "SECRET LABEL\n" }],
};
const NOW = new Date("2026-10-18T07:00:00Z");

async function deps(over: Partial<BackupDeps> = {}) {
  return {
    recipient: await identityToRecipient(await generateIdentity()),
    now: () => NOW,
    dump: vi.fn(async () => archive),
    upload: vi.fn(async () => {}),
    list: vi.fn(async () => [] as { pathname: string; uploadedAt: Date }[]),
    remove: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    ...over,
  } satisfies BackupDeps;
}

describe("runDailyBackup", () => {
  it("uploads an encrypted file, records success and prunes", async () => {
    const old = Array.from({ length: 31 }, (_, i) => ({ pathname: `backups/f${i}`, uploadedAt: new Date(2026, 0, i + 1) }));
    const d = await deps({ list: vi.fn(async () => old) });
    const result = await runDailyBackup(d);
    expect(result).toMatchObject({ status: "ok", deleted: 1, pruneFailed: false });
    const [pathname, body] = vi.mocked(d.upload).mock.calls[0];
    expect(pathname).toBe("backups/franc-20261018T070000Z.json.gz.age");
    expect(Buffer.from(body).toString("latin1")).not.toContain("SECRET LABEL");
    expect(d.record).toHaveBeenCalledWith({ at: NOW, error: null, pathname, sizeBytes: body.byteLength });
    expect(d.remove).toHaveBeenCalledWith(["backups/f0"]);
  });

  it("records the failed step and never prunes after a failed upload", async () => {
    const d = await deps({ upload: vi.fn(async () => { throw new Error("secret text"); }) });
    const result = await runDailyBackup(d);
    expect(result).toEqual({ status: "failed", step: "upload", code: null });
    expect(d.record).toHaveBeenCalledWith({ at: NOW, error: "upload" });
    expect(d.remove).not.toHaveBeenCalled();
  });

  it("passes a Postgres code through, nothing else", async () => {
    const d = await deps({ dump: vi.fn(async () => { throw Object.assign(new Error("row 1: salary"), { code: "57014" }); }) });
    expect(await runDailyBackup(d)).toEqual({ status: "failed", step: "dump", code: "57014" });
  });

  it("keeps ok when only the prune fails", async () => {
    const d = await deps({ list: vi.fn(async () => { throw new Error("x"); }) });
    expect(await runDailyBackup(d)).toMatchObject({ status: "ok", pruneFailed: true });
  });
});

describe("helpers", () => {
  it("needs both the key and the token", () => {
    expect(isBackupConfigured({ BACKUP_AGE_RECIPIENT: "a", BLOB_READ_WRITE_TOKEN: "b" })).toBe(true);
    expect(isBackupConfigured({ BACKUP_AGE_RECIPIENT: "a" })).toBe(false);
    expect(isBackupConfigured({})).toBe(false);
  });

  it("logs counts and step names only", () => {
    expect(backupLogLine({ status: "ok", sizeBytes: 10, deleted: 2, pruneFailed: false })).toBe("status=ok bytes=10 deleted=2");
    expect(backupLogLine({ status: "failed", step: "upload", code: null })).toBe("status=failed step=upload code=none");
    expect(backupLogLine({ status: "not-configured" })).toBe("status=not-configured");
  });
});
