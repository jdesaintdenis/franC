// Same encrypted backup the daily cron uploads to Blob, written to a folder instead (any Postgres, any host).
// Prints only the file name and size, never data or connection strings.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";
import postgres from "postgres";

import { dumpDatabase } from "../src/db/backup";
import { backupPathname, encryptBackup, packArchive } from "../src/lib/backup/archive";

config({ path: ".env.local" });

async function main() {
  const url = process.env.BACKUP_DATABASE_URL;
  const recipient = process.env.BACKUP_AGE_RECIPIENT;
  if (!url) throw new Error("BACKUP_DATABASE_URL is not set (the direct, non-pooler connection string).");
  if (!recipient) throw new Error("BACKUP_AGE_RECIPIENT is not set (the age PUBLIC key, starts with age1).");

  const sql = postgres(url, { max: 1 });
  try {
    const file = await encryptBackup(packArchive(await dumpDatabase(sql)), recipient);
    const dir = process.env.BACKUP_OUTPUT_DIR ?? "./backups";
    await mkdir(dir, { recursive: true });
    const out = path.join(dir, path.basename(backupPathname(new Date())));
    await writeFile(out, file);
    console.log(`Backup written: ${path.basename(out)} (${Math.ceil(file.byteLength / 1024)} KB)`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Backup failed:", error instanceof Error ? error.name : "unknown error");
  process.exit(1);
});
