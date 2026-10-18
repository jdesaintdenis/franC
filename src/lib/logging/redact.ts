/**
 * Redaction for anything that ends up in logs. Drizzle's query errors embed
 * the bound parameters in their message (`params: ...`), which are labels,
 * amounts and dates, so a DB error must never be printed as-is.
 *
 * Conservative by design: when in doubt the message is dropped and only the
 * error name, a SQLSTATE-like code and Next's digest survive.
 */

export interface SafeError {
  name: string;
  code?: string;
  digest?: string;
}

const SENSITIVE_MESSAGE = /params:|failed query|\bselect\b[\s\S]+\bfrom\b|\binsert into\b|\bupdate\b[\s\S]+\bset\b|\bdelete from\b/i;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const MAX_DEPTH = 8;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrorLike(value: unknown): value is Record<string, unknown> {
  return value instanceof Error || (isObject(value) && typeof value.name === "string" && typeof value.message === "string");
}

function pickCode(value: Record<string, unknown>): string | undefined {
  // Only short SQLSTATE-style codes (e.g. "23505") or Node codes like "ECONNREFUSED".
  const code = value.code;
  if (typeof code === "string" && (SQLSTATE.test(code) || /^[A-Z_]{3,30}$/.test(code))) return code;
  return undefined;
}

/** True when this error, or anything in its cause chain, looks DB-related. */
function isDbError(err: unknown, depth = 0): boolean {
  if (!isObject(err) || depth > MAX_DEPTH) return false;
  if ("query" in err || "params" in err) return true;
  if (typeof err.message === "string" && SENSITIVE_MESSAGE.test(err.message)) return true;
  if (typeof err.name === "string" && /DrizzleQueryError|PostgresError/.test(err.name)) return true;
  if (typeof err.constructor?.name === "string" && /DrizzleQueryError|PostgresError/.test(err.constructor.name)) return true;
  return isDbError(err.cause, depth + 1);
}

function findCode(err: unknown, depth = 0): string | undefined {
  if (!isObject(err) || depth > MAX_DEPTH) return undefined;
  return pickCode(err) ?? findCode(err.cause, depth + 1);
}

/** Maps any thrown value to something safe to print. */
export function redactError(err: unknown): SafeError & { message?: string } {
  if (!isErrorLike(err)) {
    return { name: "NonError" };
  }
  const safe: SafeError & { message?: string } = {
    name: typeof err.name === "string" && /^[A-Za-z0-9_$]{1,60}$/.test(err.name) ? err.name : "Error",
  };
  const code = findCode(err);
  if (code) safe.code = code;
  if (typeof err.digest === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(err.digest)) safe.digest = err.digest;

  const message = typeof err.message === "string" ? err.message : "";
  if (!isDbError(err) && message.length > 0 && message.length <= 300) {
    safe.message = message;
  }
  return safe;
}

function formatSafe(safe: SafeError & { message?: string }): string {
  const parts = [safe.name];
  if (safe.code) parts.push(`code=${safe.code}`);
  if (safe.digest) parts.push(`digest=${safe.digest}`);
  const head = parts.join(" ");
  return safe.message ? `${head}: ${safe.message}` : head;
}

/** Replaces Error-like args with a safe string; other args pass through unless they leak params. */
export function redactConsoleArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === "string") {
      return SENSITIVE_MESSAGE.test(arg) ? "[redacted: message contained query details]" : arg;
    }
    if (isErrorLike(arg)) return formatSafe(redactError(arg));
    return arg;
  });
}
