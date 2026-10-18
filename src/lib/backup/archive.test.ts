import { generateIdentity, identityToRecipient } from "age-encryption";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  backupPathname,
  backupsToDelete,
  decryptBackup,
  encryptBackup,
  packArchive,
  parseIdentityFile,
  unpackArchive,
  type BackupArchive,
} from "./archive";

const archive: BackupArchive = {
  format: "franc-backup",
  version: 1,
  createdAt: "2026-10-18T07:00:00.000Z",
  migrations: { count: 3, lastHash: "abc" },
  tables: [{ name: "t", columns: ["a"], rowCount: 1, copy: "x\n" }],
};

describe("archive", () => {
  it("packs and unpacks", () => {
    expect(unpackArchive(packArchive(archive))).toEqual(archive);
  });

  it("rejects anything that is not a franc backup", () => {
    expect(() => unpackArchive(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => unpackArchive(gzipSync(JSON.stringify({ ...archive, version: 2 })))).toThrow();
    expect(() => unpackArchive(gzipSync(JSON.stringify({ ...archive, format: "other" })))).toThrow();
  });

  it("encrypts to a recipient and only that identity decrypts", async () => {
    const identity = await generateIdentity();
    const other = await generateIdentity();
    const file = await encryptBackup(packArchive(archive), await identityToRecipient(identity));
    expect(unpackArchive(await decryptBackup(file, identity))).toEqual(archive);
    await expect(decryptBackup(file, other)).rejects.toThrow();
  });

  it("reads the secret key out of an age-keygen file", () => {
    const text = "# created: 2026-01-01\n# public key: age1xyz\nAGE-SECRET-KEY-1ABC\n";
    expect(parseIdentityFile(text)).toBe("AGE-SECRET-KEY-1ABC");
    expect(() => parseIdentityFile("# nothing\n")).toThrow("No AGE-SECRET-KEY");
  });

  it("names backups with a sortable UTC stamp", () => {
    expect(backupPathname(new Date("2026-10-18T07:00:12.345Z"))).toBe("backups/franc-20261018T070012Z.json.gz.age");
  });

  it("keeps the 30 newest and ignores other prefixes", () => {
    const blobs = Array.from({ length: 32 }, (_, i) => ({
      pathname: `backups/franc-${i}.json.gz.age`,
      uploadedAt: new Date(2026, 0, i + 1),
    }));
    const stale = backupsToDelete([...blobs, { pathname: "other/x", uploadedAt: new Date(2020, 0, 1) }]);
    expect(stale).toEqual(["backups/franc-1.json.gz.age", "backups/franc-0.json.gz.age"]);
    expect(backupsToDelete(blobs.slice(0, 5))).toEqual([]);
  });
});
