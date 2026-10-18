import "server-only";

import { del, list, put } from "@vercel/blob";

import { BACKUP_PREFIX } from "./archive";

// The only Vercel-specific part of the backup: swap these three to store the file elsewhere.

export async function uploadBackup(pathname: string, body: Uint8Array): Promise<void> {
  await put(pathname, Buffer.from(body), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/octet-stream",
  });
}

export async function listBackups(): Promise<{ pathname: string; uploadedAt: Date }[]> {
  const out: { pathname: string; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: BACKUP_PREFIX, cursor });
    out.push(...page.blobs.map((b) => ({ pathname: b.pathname, uploadedAt: b.uploadedAt })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function deleteBackups(pathnames: string[]): Promise<void> {
  await del(pathnames);
}
