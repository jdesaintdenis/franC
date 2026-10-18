import { gunzipSync, gzipSync } from "node:zlib";

import { Decrypter, Encrypter } from "age-encryption";
import { z } from "zod";

export const BACKUP_PREFIX = "backups/";
export const KEEP_BACKUPS = 30;

/**
 * One backup: every public table as Postgres COPY text, so any column type round-trips exactly
 * without per-type code. The migration marker lets a restore refuse a database of another shape.
 */
export const backupArchiveSchema = z.object({
  format: z.literal("franc-backup"),
  version: z.literal(1),
  createdAt: z.string(),
  migrations: z.object({ count: z.number().int().min(0), lastHash: z.string().nullable() }),
  tables: z.array(
    z.object({
      name: z.string().min(1),
      columns: z.array(z.string().min(1)).min(1),
      rowCount: z.number().int().min(0),
      copy: z.string(),
    }),
  ),
});

export type BackupArchive = z.infer<typeof backupArchiveSchema>;

export function packArchive(archive: BackupArchive): Uint8Array {
  return gzipSync(JSON.stringify(archive));
}

/** Throws on anything that is not a franc backup (wrong gzip, wrong JSON, wrong format or version). */
export function unpackArchive(bytes: Uint8Array): BackupArchive {
  return backupArchiveSchema.parse(JSON.parse(gunzipSync(bytes).toString("utf8")));
}

export async function encryptBackup(bytes: Uint8Array, recipient: string): Promise<Uint8Array> {
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  return encrypter.encrypt(bytes);
}

export async function decryptBackup(bytes: Uint8Array, identity: string): Promise<Uint8Array> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  return decrypter.decrypt(bytes, "uint8array");
}

/** The secret key line of an `age-keygen` file (the file also has `#` comment lines). */
export function parseIdentityFile(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith("AGE-SECRET-KEY-"));
  if (!line) throw new Error("No AGE-SECRET-KEY line in the identity file");
  return line.trim();
}

/** UTC stamp, so names sort in time order. */
export function backupPathname(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${BACKUP_PREFIX}franc-${stamp}.json.gz.age`;
}

/** Pathnames beyond the `keep` newest backups. Anything outside the prefix is left alone. */
export function backupsToDelete(
  blobs: { pathname: string; uploadedAt: Date }[],
  keep = KEEP_BACKUPS,
): string[] {
  return blobs
    .filter((b) => b.pathname.startsWith(BACKUP_PREFIX))
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .slice(keep)
    .map((b) => b.pathname);
}
