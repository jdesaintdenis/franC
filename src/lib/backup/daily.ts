import { backupPathname, backupsToDelete, encryptBackup, packArchive, type BackupArchive } from "./archive";

export type BackupStep = "dump" | "encrypt" | "upload";

export type BackupResult =
  | { status: "not-configured" }
  | { status: "ok"; sizeBytes: number; deleted: number; pruneFailed: boolean }
  | { status: "failed"; step: BackupStep; code: string | null };

export interface BackupRunInput {
  at: Date;
  /** A step name on failure, never an error message (those can quote data). */
  error: string | null;
  pathname?: string;
  sizeBytes?: number;
}

export interface BackupDeps {
  recipient: string;
  now: () => Date;
  dump: () => Promise<BackupArchive>;
  upload: (pathname: string, body: Uint8Array) => Promise<void>;
  list: () => Promise<{ pathname: string; uploadedAt: Date }[]>;
  remove: (pathnames: string[]) => Promise<void>;
  record: (input: BackupRunInput) => Promise<void>;
}

/** Both are needed: the key to encrypt, the token to store. Without them a self-hoster simply has no cron backup. */
export function isBackupConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.BACKUP_AGE_RECIPIENT && env.BLOB_READ_WRITE_TOKEN);
}

// Postgres errors carry a short SQLSTATE `code`; anything else could hold text from the data.
function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code: unknown };
    if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  return null;
}

/** Dump, encrypt, upload, then prune. A failed step is recorded for the Home notice and returned. */
export async function runDailyBackup(deps: BackupDeps): Promise<BackupResult> {
  const at = deps.now();
  const fail = async (step: BackupStep, error: unknown): Promise<BackupResult> => {
    await deps.record({ at, error: step });
    return { status: "failed", step, code: errorCode(error) };
  };

  let archive: BackupArchive;
  try {
    archive = await deps.dump();
  } catch (error) {
    return fail("dump", error);
  }

  let encrypted: Uint8Array;
  try {
    encrypted = await encryptBackup(packArchive(archive), deps.recipient);
  } catch (error) {
    return fail("encrypt", error);
  }

  const pathname = backupPathname(at);
  try {
    await deps.upload(pathname, encrypted);
  } catch (error) {
    return fail("upload", error);
  }

  await deps.record({ at, error: null, pathname, sizeBytes: encrypted.byteLength });

  // The new backup is already safe: a failed prune only means an old one stays until tomorrow.
  try {
    const stale = backupsToDelete(await deps.list());
    if (stale.length > 0) await deps.remove(stale);
    return { status: "ok", sizeBytes: encrypted.byteLength, deleted: stale.length, pruneFailed: false };
  } catch {
    return { status: "ok", sizeBytes: encrypted.byteLength, deleted: 0, pruneFailed: true };
  }
}

/** Counts and step names only. */
export function backupLogLine(result: BackupResult): string {
  switch (result.status) {
    case "not-configured":
      return "status=not-configured";
    case "ok":
      return `status=ok bytes=${result.sizeBytes} deleted=${result.deleted}${result.pruneFailed ? " pruneFailed=1" : ""}`;
    case "failed":
      return `status=failed step=${result.step} code=${result.code ?? "none"}`;
  }
}
