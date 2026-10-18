export const MAX_TAG_LENGTH = 40;
export const MAX_NOTE_LENGTH = 500;
export const MAX_TAGS_PER_TRANSACTION = 10;
export const MAX_TAGS_PER_USER = 200;

export type TagNameError = "empty" | "tooLong" | "comma";

export type TagNameResult = { ok: true; name: string } | { ok: false; code: TagNameError };

/**
 * NFC, trim, collapse inner whitespace. The length limit counts characters after
 * normalization; commas are refused because the tag input and the export use them as separators.
 */
export function normalizeTagName(input: string): TagNameResult {
  const name = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, code: "empty" };
  if (name.includes(",")) return { ok: false, code: "comma" };
  if ([...name].length > MAX_TAG_LENGTH) return { ok: false, code: "tooLong" };
  return { ok: true, name };
}

/**
 * Splits comma-separated input into normalized names, skipping empty entries and dropping
 * case-insensitive duplicates (the first spelling wins). Invalid entries (too long) are
 * returned as errors so callers can report them.
 */
export function parseTagList(input: string): { names: string[]; errors: TagNameError[] } {
  const names: string[] = [];
  const errors: TagNameError[] = [];
  const seen = new Set<string>();
  for (const part of input.split(",")) {
    const result = normalizeTagName(part);
    if (!result.ok) {
      if (result.code !== "empty") errors.push(result.code);
      continue;
    }
    const key = result.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(result.name);
  }
  return { names, errors };
}

export type NoteResult = { ok: true; note: string | null } | { ok: false; code: "tooLong" };

/** Trim; empty becomes null; line breaks are kept. */
export function normalizeNote(input: string): NoteResult {
  const note = input.replace(/\r\n?/g, "\n").trim();
  if (note === "") return { ok: true, note: null };
  if ([...note].length > MAX_NOTE_LENGTH) return { ok: false, code: "tooLong" };
  return { ok: true, note };
}
